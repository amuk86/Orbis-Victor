import type { Command,GameState } from '../game/engine';
export type RemoteGame = {
  state:GameState; canControl:boolean; pending:boolean;
  notice?:string;
  send:(command:Command)=>Promise<void>;
  npcStep:()=>Promise<void>;
  npcBatch:()=>Promise<void>;
  setPlaybackPaused?:(paused:boolean)=>void;
  launch:(source:string,target:string)=>Promise<void>;
  leave:()=>void;
};
