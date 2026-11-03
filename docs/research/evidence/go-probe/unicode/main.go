package main
import("encoding/json";"fmt")
func main(){var s string;err:=json.Unmarshal([]byte(`"\ud800"`), &s);fmt.Printf("error=%v decoded=%q runes=%U\n",err,s,[]rune(s))}
