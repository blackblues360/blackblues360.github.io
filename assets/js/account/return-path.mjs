export function toolReturnPath(value,origin){
  if(typeof value!=='string'||!value)return null;
  try{const url=new URL(value,origin);return url.origin===origin&&!url.username&&!url.password&&url.pathname.startsWith('/tools/')?url.pathname+url.search+url.hash:null;}catch{return null;}
}
