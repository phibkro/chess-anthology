// Command chess-compiler exposes a JSON-lines compiler adapter and native benchmark worker.
package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"time"

	compiler "github.com/phibkro/chess-anthology/compiler"
	c "github.com/phibkro/chess-anthology/compiler/contracts"
)

type Source = c.Source

func sourceMap(items []Source) map[string]c.Text {
	out := map[string]c.Text{}
	for _, s := range items {
		out[string(s.URI)] = s.Text
	}
	return out
}

type Request struct {
	Action   string          `json:"action"`
	Sources  []Source        `json:"sources"`
	Updates  [][]Source      `json:"updates"`
	Source   c.Text          `json:"source"`
	Data     json.RawMessage `json:"data"`
	Input    json.RawMessage `json:"input"`
	Snapshot c.Snapshot      `json:"snapshot"`
	URI      string          `json:"uri"`
	Story    string          `json:"story"`
	Ply      json.RawMessage `json:"ply"`
}

func result[T any](v T, f *c.Failure) any {
	if f != nil {
		return c.Failed[T](f)
	}
	return c.Success(v)
}
func dispatch(r Request) any {
	switch r.Action {
	case "compile":
		v, f := compiler.CompileOrdered(r.Sources)
		return result(v, f)
	case "session":
		comp := compiler.CreateCompiler()
		var v c.Update
		for _, sources := range r.Updates {
			var f *c.Failure
			v, f = comp.UpdateOrdered(sources)
			if f != nil {
				return result(v, f)
			}
		}
		return result(v, nil)
	case "decode":
		v, f := compiler.Decode(r.Source)
		return result(v, f)
	case "structured":
		v, f := compiler.ParseStructured(r.Data)
		return result(v, f)
	case "print":
		v, f := compiler.PrintStructured(r.Data)
		return result(v, f)
	case "envelope":
		d, f := compiler.ParseStructured(r.Data)
		if f != nil {
			return result(c.Envelope{}, f)
		}
		return result(compiler.Envelope(d, r.Source), nil)
	case "restore":
		v, f := compiler.Restore(r.Input)
		return result(v, f)
	case "plan":
		v, f := compiler.CreatePlaybackPlan(r.Snapshot, r.URI, r.Story)
		return result(v, f)
	case "select":
		var ply c.Integer
		if e := ply.UnmarshalJSON(r.Ply); e != nil {
			return result(c.Frame{}, c.Fail("selection", "view/invalid-ply", "Ply must be a nonnegative safe integer."))
		}
		v, f := compiler.SelectPosition(r.Snapshot, r.URI, ply)
		return result(v, f)
	}
	return result(false, c.Fail("schema", "adapter/unknown-action", "Unknown compiler operation."))
}
func rpc() error {
	scanner := bufio.NewScanner(os.Stdin)
	scanner.Buffer(make([]byte, 64*1024), 64*1024*1024)
	enc := json.NewEncoder(os.Stdout)
	enc.SetEscapeHTML(false)
	for scanner.Scan() {
		var req Request
		var out any
		if e := json.Unmarshal(scanner.Bytes(), &req); e != nil {
			out = result(false, c.Fail("schema", "adapter/invalid-request", e.Error()))
		} else {
			out = dispatch(req)
		}
		if e := enc.Encode(out); e != nil {
			return e
		}
	}
	return scanner.Err()
}

type BenchmarkCase struct {
	Stories  int        `json:"stories"`
	Scenario string     `json:"scenario"`
	Initial  []Source   `json:"initial"`
	Sources  []Source   `json:"sources"`
	Samples  [][]Source `json:"samples"`
	Expected c.Work     `json:"expected"`
}

func rss(key string) uint64 {
	raw, e := os.ReadFile("/proc/self/status")
	if e != nil {
		return 0
	}
	for _, line := range strings.Split(string(raw), "\n") {
		fields := strings.Fields(line)
		if len(fields) >= 2 && fields[0] == key+":" {
			n, _ := strconv.ParseUint(fields[1], 10, 64)
			return n * 1024
		}
	}
	return 0
}
func median(xs []float64) float64 {
	s := append([]float64{}, xs...)
	sort.Float64s(s)
	return (s[(len(s)-1)/2] + s[len(s)/2]) / 2
}
func worker(path string) error {
	file, e := os.Open(path)
	if e != nil {
		return e
	}
	defer file.Close()
	decoder := json.NewDecoder(file)
	task := os.Getenv("CHESS_MODE_TASK")
	if task == "once" {
		token, e := decoder.Token()
		if e != nil || token != json.Delim('[') {
			return fmt.Errorf("expected workload array")
		}
		var first BenchmarkCase
		if e := decoder.Decode(&first); e != nil {
			return e
		}
		u, f := compiler.CreateCompiler().UpdateOrdered(first.Sources)
		if f != nil {
			return f
		}
		return json.NewEncoder(os.Stdout).Encode(u.Work)
	}
	var cases []BenchmarkCase
	if e := decoder.Decode(&cases); e != nil {
		return e
	}
	if task != "benchmark" {
		return fmt.Errorf("unsupported native task %q", task)
	}
	rows := []any{}
	for _, tc := range cases {
		samples := []float64{}
		memory := []uint64{}
		var work c.Work
		for sample := -2; sample < 5; sample++ {
			var comp *compiler.Compiler
			if tc.Scenario != "initial" {
				comp = compiler.CreateCompiler()
				if _, f := comp.UpdateOrdered(tc.Initial); f != nil {
					return f
				}
			}
			if len(tc.Samples) != 7 {
				return fmt.Errorf("expected seven sample-specific source maps")
			}
			next := tc.Samples[sample+2]
			start := time.Now()
			if comp == nil {
				comp = compiler.CreateCompiler()
			}
			update, f := comp.UpdateOrdered(next)
			elapsed := float64(time.Since(start).Nanoseconds()) / 1e6
			if f != nil {
				return f
			}
			work = update.Work
			if work != tc.Expected {
				return fmt.Errorf("work mismatch %s/%d: %+v != %+v", tc.Scenario, tc.Stories, work, tc.Expected)
			}
			if len(update.Snapshot.Output) != tc.Stories+1 {
				return fmt.Errorf("output count")
			}
			for _, d := range update.Snapshot.Output {
				if len(d.Diagnostics) != 0 {
					return fmt.Errorf("invalid benchmark document: %+v", d.Diagnostics)
				}
			}
			if sample >= 0 {
				samples = append(samples, elapsed)
				memory = append(memory, rss("VmRSS"))
			}
		}
		sorted := append([]float64{}, samples...)
		sort.Float64s(sorted)
		rows = append(rows, map[string]any{"stories": tc.Stories, "scenario": tc.Scenario, "medianMs": median(samples), "p95Ms": sorted[len(sorted)-1], "samplesMs": samples, "rssBytes": memory, "work": work})
	}
	return json.NewEncoder(os.Stdout).Encode(map[string]any{"format": "chess-compiler-benchmark", "version": 2, "iterations": 5, "warmups": 2, "results": rows, "environment": map[string]any{"arch": runtime.GOARCH, "platform": runtime.GOOS, "runtime": map[string]string{"name": "go", "version": runtime.Version()}}, "memoryScope": "Linux process-wide RSS outside timed operations, not allocations; zero if unavailable", "processPeakRssBytes": rss("VmHWM"), "timingScope": "Warm process; same externally supplied workload source bytes; native compiler measured without IPC. First compilation measured externally."})
}
func main() {
	var e error
	if len(os.Args) == 3 && os.Args[1] == "--worker" {
		e = worker(os.Args[2])
	} else {
		e = rpc()
	}
	if e != nil {
		fmt.Fprintln(os.Stderr, e)
		os.Exit(1)
	}
}
