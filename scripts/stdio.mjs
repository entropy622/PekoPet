import { Console } from 'node:console';
// Libraries log through console; JSON-RPC alone owns stdout.
const diagnostics=new Console({stdout:process.stderr,stderr:process.stderr});
console.log=diagnostics.log.bind(diagnostics);
console.info=diagnostics.info.bind(diagnostics);
console.debug=diagnostics.debug.bind(diagnostics);
