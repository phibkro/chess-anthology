// chess-lsp serves the narrative editor protocol over Content-Length framed stdio.
package main

import (
	"context"
	"fmt"
	"github.com/phibkro/chess-anthology/compiler/internal/lsp"
	"io"
	"os"
)

type stdio struct{ reader *io.PipeReader }

func (s stdio) Read(p []byte) (int, error) { return s.reader.Read(p) }
func (stdio) Write(p []byte) (int, error)  { return os.Stdout.Write(p) }
func (s stdio) Close() error               { return s.reader.Close() }
func main() {
	// Closing the transport must interrupt reads even while the client keeps stdin open.
	reader, writer := io.Pipe()
	go func() { _, err := io.Copy(writer, os.Stdin); _ = writer.CloseWithError(err) }()
	if e := lsp.Serve(context.Background(), stdio{reader}); e != nil {
		fmt.Fprintln(os.Stderr, e)
		os.Exit(1)
	}
}
