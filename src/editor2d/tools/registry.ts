import type { ToolId } from '../../app/store';
import { CalibrateTool, EraseTool, MeasureTool, PanTool, TextTool } from './misc';
import { FurnitureTool, OpeningTool } from './place';
import { RoomTool } from './room';
import { SelectTool } from './select';
import type { EditorApi, Tool } from './types';
import { WallTool } from './wall';

export class EditTools {
  readonly select: SelectTool;
  readonly calibrate: CalibrateTool;
  readonly all: Record<ToolId, Tool>;
  constructor(api: EditorApi) {
    this.select = new SelectTool(api);
    this.calibrate = new CalibrateTool(api);
    this.all = {
      select: this.select,
      wall: new WallTool(api),
      room: new RoomTool(api),
      door: new OpeningTool('door', api),
      window: new OpeningTool('window', api),
      furniture: new FurnitureTool(api),
      measure: new MeasureTool(api),
      text: new TextTool(api),
      erase: new EraseTool(api),
      pan: new PanTool(api),
      calibrate: this.calibrate,
    };
  }
}
