import { createInterface } from 'node:readline';
createInterface({input:process.stdin}).on('line',line=>{
  const request=JSON.parse(line);if(request.id===undefined)return;
  let result;
  if(request.method==='initialize')result={protocolVersion:request.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'PekoPet test fixture',version:'1'}};
  if(request.method==='tools/list')result={tools:[{name:'echo',description:'Return the supplied fixture text',inputSchema:{type:'object',properties:{text:{type:'string'}},required:['text']}}]};
  if(request.method==='tools/call')result={content:[{type:'text',text:request.params.arguments.text}]};
  process.stdout.write(JSON.stringify(result?{jsonrpc:'2.0',id:request.id,result}:{jsonrpc:'2.0',id:request.id,error:{code:-32601,message:'Unknown fixture method'}})+'\n');
});
