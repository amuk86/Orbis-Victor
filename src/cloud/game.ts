import type { Command,GameState } from '../game/engine';
export type RemoteGame = {
  state:GameState; canControl:boolean; pending:boolean;
  send:(command:Command)=>Promise<void>;
  npcStep:()=>Promise<void>;
  launch:(source:string,target:string)=>Promise<void>;
  leave:()=>void;
};
