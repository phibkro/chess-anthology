import subprocess,json,select,time,os
from pathlib import Path
root=str(Path(__file__).resolve().parent.parent)
p=subprocess.Popen(['bun','src/adapters/lsp.ts','--stdio'],cwd=root,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
def send(message):
 data=json.dumps(message).encode();p.stdin.write(f'Content-Length: {len(data)}\r\n\r\n'.encode()+data);p.stdin.flush()
buf=b''
def receive_until(predicate,timeout=30):
 global buf
 deadline=time.time()+timeout
 while time.time()<deadline:
  if b'\r\n\r\n' in buf:
   head,body=buf.split(b'\r\n\r\n',1);length=int(head.split(b'Content-Length: ')[1].split(b'\r\n')[0])
   if len(body)>=length:
    msg=json.loads(body[:length]);buf=body[length:]
    if predicate(msg):return msg
    continue
  ready,_,_=select.select([p.stdout,p.stderr],[],[],1)
  for f in ready:
   data=os.read(f.fileno(),65536)
   if f is p.stderr and data:print('stderr:',data.decode())
   elif data:buf+=data
  if p.poll() is not None:raise AssertionError('LSP exited: '+str(p.returncode))
 raise AssertionError('Timed out waiting for LSP response')
try:
 send({'jsonrpc':'2.0','id':1,'method':'initialize','params':{'processId':None,'rootUri':'file://'+root+'/examples/','capabilities':{},'workspaceFolders':[{'uri':'file://'+root+'/examples/','name':'examples'}]}})
 result=receive_until(lambda m:m.get('id')==1);assert 'result' in result,result
 send({'jsonrpc':'2.0','method':'initialized','params':{}})
 uri='file://'+root+'/examples/story.chess-story';text=open(root+'/examples/story.chess-story').read()
 send({'jsonrpc':'2.0','method':'textDocument/didOpen','params':{'textDocument':{'uri':uri,'languageId':'chess-narrative','version':1,'text':text}}})
 diagnostics=receive_until(lambda m:m.get('method')=='textDocument/publishDiagnostics' and m['params']['uri']==uri)
 assert diagnostics['params']['diagnostics']==[],diagnostics
 send({'jsonrpc':'2.0','id':2,'method':'shutdown','params':None});receive_until(lambda m:m.get('id')==2)
 send({'jsonrpc':'2.0','method':'exit','params':None});p.wait(timeout=5)
 print('Bun LSP initialize/open/imported-game diagnostics/shutdown: passed')
finally:
 if p.poll() is None:p.kill()
