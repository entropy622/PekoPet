export interface Rect {x:number;y:number;width:number;height:number}
export interface Anchor {x:number;y:number}
export const PET_WIDTH=400,PET_HEIGHT=600,MAX_OFFSCREEN=.75;
const clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(max,value));
export function petSize(scale:number,screen:Rect){
  const maximum=Math.min(4,screen.width/(PET_WIDTH*(1-MAX_OFFSCREEN)),screen.height/(PET_HEIGHT*(1-MAX_OFFSCREEN)));
  const zoom=clamp(scale,.1,maximum);
  return {scale:zoom,width:Math.round(PET_WIDTH*zoom),height:Math.round(PET_HEIGHT*zoom)};
}
/** Per-axis visibility, including negative-coordinate displays. All values are DIPs. */
export function constrainPet(rect:Rect,screen:Rect):Rect{
  return {...rect,x:clamp(Math.round(rect.x),Math.ceil(screen.x-MAX_OFFSCREEN*rect.width),Math.floor(screen.x+screen.width-(1-MAX_OFFSCREEN)*rect.width)),y:clamp(Math.round(rect.y),Math.ceil(screen.y-MAX_OFFSCREEN*rect.height),Math.floor(screen.y+screen.height-(1-MAX_OFFSCREEN)*rect.height))};
}
export function zoomPet(rect:Rect,scale:number,screen:Rect,anchor:Anchor={x:.5,y:1}){
  const size=petSize(scale,screen),x=clamp(anchor.x,0,1),y=clamp(anchor.y,0,1);
  return {...constrainPet({x:rect.x+rect.width*x-size.width*x,y:rect.y+rect.height*y-size.height*y,width:size.width,height:size.height},screen),scale:size.scale};
}
/** Keep a wheel gesture anchored to its original screen point, without rounding drift. */
export class PetWheelZoom {
  private gesture?:{origin:Rect;anchor:Anchor;point:Anchor;screen:Rect;last:Rect;scale:number;time:number};
  next(rect:Rect,scale:number,delta:number,screen:Rect,point:Anchor,time:number){
    let g=this.gesture;
    if(!g||time-g.time>350||Math.abs(point.x-g.point.x)>2||Math.abs(point.y-g.point.y)>2||scale!==g.scale||(['x','y','width','height'] as const).some(key=>Math.abs(rect[key]-g!.last[key])>1||screen[key]!==g!.screen[key])){
      g={origin:{...rect},anchor:{x:(point.x-rect.x)/rect.width,y:(point.y-rect.y)/rect.height},point:{...point},screen:{...screen},last:rect,scale,time};
    }
    const value=zoomPet(g.origin,scale*Math.exp(-delta*.001),screen,g.anchor);
    g.last=value;g.scale=value.scale;g.time=time;this.gesture=g;return value;
  }
}
export function restorePet(settings:{petX?:number;petY?:number;petScale?:number;petWidth?:number;petHeight?:number},screen:Rect){
  const size=petSize(settings.petScale??1,screen);
  const dx=(settings.petWidth??size.width)-size.width,dy=(settings.petHeight??size.height)-size.height;
  const x=(settings.petX??screen.x+screen.width-size.width)+(Math.abs(dx)>1?dx/2:0),y=(settings.petY??screen.y+screen.height-size.height)+(Math.abs(dy)>1?dy/2:0);
  return {...constrainPet({x,y,width:size.width,height:size.height},screen),scale:size.scale};
}
export function recoverPet(rect:Rect,scale:number,workArea:Rect){
  const size=petSize(Math.min(scale,workArea.width/PET_WIDTH,workArea.height/PET_HEIGHT),workArea);
  return {...size,x:Math.round(workArea.x+workArea.width-size.width),y:Math.round(workArea.y+workArea.height-size.height)};
}
