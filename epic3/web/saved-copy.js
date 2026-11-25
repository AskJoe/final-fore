'use strict';
// Keeps each page's last server answer on this computer so the page can open from it
// at once and then check the server for changes. The sign-in page clears every copy.
window.FinalForeSaved=(()=>{
 const name='ffm-pages-saved-v1';
 return {
  async read(path){try{const hit=await (await caches.open(name)).match(path);return hit?await hit.text():null;}catch{return null;}},
  write(path,text){try{caches.open(name).then(store=>store.put(path,new Response(text,{headers:{'Content-Type':'application/json'}}))).catch(()=>{});}catch{}},
  offline:'Final Fore could not be reached. Showing the copy kept on this computer.',
 };
})();
