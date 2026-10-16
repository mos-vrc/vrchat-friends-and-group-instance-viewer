// Make a small static image from the existing shared image download. Only pins
// use this path; image failure must never remove the saved text.
export const NOTIFICATION_IMAGE_BACKGROUND = '#1b1c1f';
export async function notificationThumbnail(pool,url){
  if(!url)return '';
  const lease=pool.acquire(url);
  try{
    const blobUrl=await lease.promise,image=new Image();image.src=blobUrl;await image.decode();
    const canvas=document.createElement('canvas');const scale=Math.min(1,160/image.naturalWidth,160/image.naturalHeight);
    canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
    const ctx=canvas.getContext('2d');ctx.fillStyle=NOTIFICATION_IMAGE_BACKGROUND;ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);
    for(const quality of [.75,.5,.3]){const value=canvas.toDataURL('image/jpeg',quality);if(value.length<=24000)return value;}
    return '';
  }finally{lease.release();}
}
