grammar ChessNarrative
entry Module:
    'module' name=ID ';' imports+=Import* declarations+=Declaration*;
Import: 'import' path=STRING ';';
Declaration: Game | Story;
Game: exported?='export'? 'game' name=ID 'from' path=STRING ';';
Story: 'story' name=ID '{' scenes+=Scene* '}';
Scene: 'board' name=ID 'game' game=[Game:ID] 'after' ply=INT '{' notes+=Note* '}';
Note: Text | Arrow | Prompt;
Text: 'text' text=STRING ';';
Arrow: 'arrow' from=STRING '->' to=STRING color=ID ';';
Prompt: 'prompt' text=STRING 'answer' answer=STRING ';';
hidden terminal WS: /\s+/;
terminal ID: /[_a-zA-Z][_a-zA-Z0-9-]*/;
terminal INT returns number: /[0-9]+/;
terminal STRING: /"([^"\\\x00-\x1F]|\\(["\\\/bfnrt]|u[0-9a-fA-F]{4}))*"/;
hidden terminal SL_COMMENT: /\/\/[^\n\r]*/;
hidden terminal ML_COMMENT: /\/\*[\s\S]*?\*\//;
