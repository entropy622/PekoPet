/** Structured bootstrap rows shared by the existing dsh component registry. */
export function renderIndex(html:string,rows:any[]){
  const attribute=(value:string)=>value.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
  let head='',body='';
  for(const row of rows){let text='';
    if(row.kind==='script')text='<script>'+row.text+'</script>';
    else if(row.kind==='script-src')text='<script src="'+attribute(row.src)+'"></script>';
    else if(row.kind==='script-preload')text='<link rel="preload" as="script" href="'+attribute(row.src)+'">';
    else if(row.kind==='global')text='<script>globalThis['+JSON.stringify(row.name)+']='+(row.value===undefined?'undefined':JSON.stringify(row.value).replaceAll('<','\\u003c'))+'</script>';
    else if(row.kind==='style')text='<style>'+row.text+'</style>';
    else if(row.kind==='html')text=row.html;
    else throw new Error('未知引导条目：'+row.kind);
    if(row.placement==='body')body+=text;else head+=text;
  }
  body+='<script>(globalThis.__DSH_BOOT_READY__??=Promise.withResolvers()).resolve()</script>';
  return html.replace(/<head(?:\s[^>]*)?>/i,open=>open+head).replace(/<body(?:\s[^>]*)?>/i,open=>open+body);
}
