import {DatabaseSync} from 'node:sqlite';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {defaultSettings} from '../plugin/state.mjs';

/** Read-only preferences for the desktop, before Cordis and tools initialize. */
export function readBootstrap(home){
  const file=join(home,'peko-pet/state.sqlite3');
  if(!existsSync(file))return {...defaultSettings};
  const db=new DatabaseSync(file,{readOnly:true});
  try{return {...defaultSettings,...JSON.parse(db.prepare('SELECT value FROM settings WHERE id=1').get()?.value??'{}')};}
  finally{db.close();}
}
