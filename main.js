// ============================================================
// ZAEVI — Customer Frontend Integration (Phase 5)
// Uses the existing backend APIs:
//   POST /api/auth/login, POST /api/auth/register, POST /api/auth/logout, GET /api/auth/me
//   GET /api/customer/orders, POST /api/orders
// CSRF: reads zaevi.csrf cookie (non-HttpOnly) and sends
//      x-csrf-token header for state-changing requests (authenticated).
// Never trusts client-side state as proof of authentication;
// the server session remains authoritative.
// ============================================================

const $=(s,p=document)=>p.querySelector(s), $$=(s,p=document)=>[...p.querySelectorAll(s)];
const money=n=>'₹'+Number(n).toLocaleString('en-IN');
// Escape values that originate from the API before they are placed in an
// innerHTML template. Customer name/email and order snapshots are data, never
// markup; escaping keeps a crafted profile value from becoming executable HTML.
function escapeHtml(v){
 return String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
const CART_KEY='zaeviCart', WISH_KEY='zaeviWish';
// Production workflow labels. The server stores `pending` for historical
// compatibility; it is presented as "Order Received".
const ORDER_STATUS_LABELS={pending:'Order Received',confirmed:'Confirmed',in_production:'In Production',quality_check:'Quality Check',packed:'Packed',shipped:'Shipped',delivered:'Delivered',cancelled:'Cancelled'};
function orderStatusLabel(v){return ORDER_STATUS_LABELS[v]||'Processing';}

// Read a stored list safely: malformed JSON or a non-array value must never
// throw at load time. The raw value is left untouched (we never delete data).
function readStoredList(key){
 try{const raw=localStorage.getItem(key);if(!raw)return[];const parsed=JSON.parse(raw);return Array.isArray(parsed)?parsed:[]}catch(e){return[]}
}
// Cart entries keep their existing shape ({id,name,price,img,qty}); only
// structurally valid rows are kept so a corrupt array cannot break the bag.
function readCart(){return readStoredList(CART_KEY).filter(x=>x&&typeof x==='object'&&!Array.isArray(x)&&typeof x.id==='string'&&Number.isFinite(+x.qty)&&+x.qty>0)}
// Size handling. A product is "size dependent" when it offers a real choice; a
// single generic size (e.g. the tote's "One Size") is not a real choice and must
// not force the customer to pick one. Selected sizes are preserved per line.
const ONE_SIZE=/^(one size|one-size|onesize|os|free size|freesize|universal)$/i;
function productSizes(p){return Array.isArray(p&&p.sizes)?p.sizes.filter(s=>typeof s==='string'&&s.trim()!==''):[]}
function isSizeDependent(p){const s=productSizes(p);if(!s.length)return false;if(s.length>1)return true;return !ONE_SIZE.test(s[0].trim())}
function resolveSize(p,requested){const sizes=productSizes(p);if(typeof requested==='string'){const m=sizes.find(s=>s===requested);if(m)return m}if(!isSizeDependent(p))return sizes[0]||null;return null}
// Add a line, or bump the quantity of the exact same (id, size) line. Different
// sizes of the same product stay separate lines.
function upsertCartLine(lines,p,size,quantity){const out=Array.isArray(lines)?lines.slice():[];const q=(Number.isInteger(quantity)&&quantity>0)?quantity:1;const i=out.findIndex(x=>x&&x.id===p.id&&x.size===size);if(i>=0)out[i]=Object.assign({},out[i],{qty:(+out[i].qty||0)+q});else out.push({id:p.id,name:p.name,price:p.price,img:p.img,qty:q,size});return out}
function sizeNotice(msg){const n=$('#sizeNotice');if(n){n.textContent=msg||'';n.hidden=!msg}}
// Wishlist entries are product-id strings.
function readWishlist(){return readStoredList(WISH_KEY).filter(x=>typeof x==='string'&&x!=='')}
// Toggle one product id in the persisted wishlist. Returns the new pressed
// state so every caller (cards, product detail) can synchronise its control.
function toggleWish(id){
  if(typeof id!=='string'||!id)return false;
  if(wishlist.includes(id))wishlist=wishlist.filter(x=>x!==id);else wishlist.push(id);
  localStorage.setItem(WISH_KEY,JSON.stringify(wishlist));
  return wishlist.includes(id);
}
// Mirror persisted wishlist state onto a button: pressed state, accessible
// name and the visible heart glyph. Shared by product cards and the PDP.
function syncWishButton(b,id,name){
  if(!b||typeof b.setAttribute!=='function')return;
  const active=wishlist.includes(id);
  const label=name||id||'this piece';
  b.setAttribute('aria-pressed',String(active));
  b.setAttribute('aria-label',`${active?'Remove':'Add'} ${label} ${active?'from':'to'} wishlist`);
  const icon=typeof b.querySelector==='function'?b.querySelector('[aria-hidden="true"]'):null;
  if(icon)icon.textContent=active?'♥':'♡';
}
let products=[], cart=readCart(), wishlist=readWishlist();
let searchSeq=0, searchTimer=null;

function validFront(list){
 return Array.isArray(list)&&list.length>0&&list.every(p=>p&&typeof p.id==='string'&&typeof p.name==='string'&&typeof p.price==='number'&&Array.isArray(p.sizes))
}
function validApi(list){
 return Array.isArray(list)&&list.length>0&&list.every(p=>p&&typeof p.id==='string'&&typeof p.name==='string'&&typeof p.category==='string'&&typeof p.price==='number'&&typeof p.imageUrl==='string'&&typeof p.hoverImageUrl==='string'&&Array.isArray(p.sizes))
}
function toFront(p){
 return{id:p.id,name:p.name,cat:p.category,gender:p.gender,price:p.price,color:p.color,sizes:p.sizes,img:p.imageUrl,hover:p.hoverImageUrl,desc:p.description,available:p.available}
}
async function loadProducts(){
 try{const r=await fetch('/api/products?limit=100');if(r.ok){const j=await r.json();if(j&&validApi(j.data))return j.data.map(toFront)}}catch(e){}
 try{const r=await fetch('products.json');if(r.ok){const j=await r.json();if(validFront(j))return j}}catch(e){}
 return [];
}
async function init(){
 products=await loadProducts();
 updateBag(); renderCart(); renderHome(); renderCatalog(); renderWishlist(); setupGlobal(); renderProduct(); setupAnnouncementBar();
}

// ============================================================
// Storefront rendering, cart drawer, catalog, wishlist, search
// (restored from main.js.bak — this layer had been dropped)
// ============================================================
function setupGlobal(){
 setTimeout(()=>$('.loader')?.classList.add('off'),900);
 const nav=$('.nav'); let prev=scrollY;
 addEventListener('scroll',()=>{nav?.classList.toggle('light',scrollY>45); if(scrollY>prev&&scrollY>160)nav?.classList.add('hide');else nav?.classList.remove('hide');prev=scrollY},{passive:true});
 const io=new IntersectionObserver(es=>es.forEach(e=>e.isIntersecting&&e.target.classList.add('in')),{threshold:.12});
 $$('.reveal').forEach(x=>io.observe(x));
 const mobileMenu=$('.mobilemenu'), menuBtn=$('.menu'), searchOverlay=$('.search'), drawer=$('.drawer'), overlay=$('.overlay');
 const isOpen=el=>!!(el&&el.classList&&el.classList.contains('open'));
 const lockBody=()=>{if(document.body&&document.body.classList)document.body.classList.toggle('lock',isOpen(mobileMenu)||isOpen(searchOverlay)||isOpen(drawer))};
 const setSearchOpen=open=>{if(!searchOverlay)return;searchOverlay.classList.toggle('open',open);searchOverlay.setAttribute('aria-hidden',String(!open));if(open){if(mobileMenu){mobileMenu.classList.remove('open');mobileMenu.setAttribute('aria-hidden','true');menuBtn?.setAttribute('aria-expanded','false')}$('.search input')?.focus()}lockBody()};
 const setMobileMenuOpen=open=>{if(!mobileMenu)return;mobileMenu.classList.toggle('open',open);mobileMenu.setAttribute('aria-hidden',String(!open));menuBtn?.setAttribute('aria-expanded',String(open));if(open)setSearchOpen(false);lockBody()};
 let cartReturnFocus=null;
 // custom cursor
 if(matchMedia('(pointer:fine)').matches){
   const c=document.createElement('div');c.className='cursor';const d=document.createElement('div');d.className='dot';document.body.append(c,d);
   let x=innerWidth/2,y=innerHeight/2,cx=x,cy=y;
   addEventListener('mousemove',e=>{x=e.clientX;y=e.clientY});
   (function loop(){cx+=(x-cx)*.18;cy+=(y-cy)*.18;c.style.left=cx+'px';c.style.top=cy+'px';d.style.left=x+'px';d.style.top=y+'px';requestAnimationFrame(loop)})();
   $$('a,button,.product').forEach(el=>{el.addEventListener('mouseenter',()=>c.classList.add('big'));el.addEventListener('mouseleave',()=>c.classList.remove('big'))});
 }
 const finishClosingCart=()=>{closeCart();cartReturnFocus?.focus?.();cartReturnFocus=null};
 menuBtn?.addEventListener('click',()=>{setMobileMenuOpen(true);$('.mobile-close')?.focus()});
 $('.mobile-close')?.addEventListener('click',()=>{setMobileMenuOpen(false);menuBtn?.focus?.()});
 $$('[data-search]').forEach(x=>x.addEventListener('click',e=>{e.preventDefault();setMobileMenuOpen(false);setSearchOpen(true)}));
 $('.search .x')?.addEventListener('click',()=>setSearchOpen(false));
 addEventListener('keydown',e=>{
  if(e.key!=='Escape')return;
  if(isOpen(searchOverlay)){setSearchOpen(false);return}
  if(isOpen(mobileMenu)){setMobileMenuOpen(false);menuBtn?.focus?.();return}
  if(isOpen(drawer))finishClosingCart();
 });
 const si=$('.search input');if(si){si.addEventListener('input',()=>{clearTimeout(searchTimer);const q=si.value.trim();searchTimer=setTimeout(()=>runSearch(q),250)});si.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();clearTimeout(searchTimer);runSearch(si.value.trim())}})}
 $$('[data-cart]').forEach(x=>x.addEventListener('click',e=>{e.preventDefault();const fromMobile=!!x.closest('.mobilemenu');setMobileMenuOpen(false);setSearchOpen(false);if(fromMobile)cartReturnFocus=menuBtn;openCart();if(fromMobile)$('.cart-close')?.focus()}));
 $('.cart-close')?.addEventListener('click',finishClosingCart);overlay?.addEventListener('click',finishClosingCart);overlay?.addEventListener('click',()=>{if(isOpen(mobileMenu)){setMobileMenuOpen(false);menuBtn?.focus?.()}});
}
function updateBag(){const n=cart.reduce((s,x)=>s+x.qty,0);$$('.bagnum').forEach(x=>x.textContent=n)}
function save(){localStorage.setItem('zaeviCart',JSON.stringify(cart));updateBag();renderCart()}
function add(id,requestedSize){
 const p=products.find(x=>x.id===id);if(!p)return false;
 const size=resolveSize(p,requestedSize);if(!size){sizeNotice('Please select a size to add this piece to your bag.');return false}
 sizeNotice('');
 cart=upsertCartLine(cart,p,size,1);
 window.__zaeviJustAdded=true;
 save();openCart();
 return true;
}
function removeAt(i){cart.splice(i,1);save()}
function changeQty(i,delta){
 const x=cart[i];if(!x)return;
 const next=x.qty+delta;
 if(!Number.isFinite(next)||next<1||next>10)return;
 cart[i]=Object.assign({},x,{qty:next});
 save();
}
function openCart(){const d=$('.drawer'),o=$('.overlay');d?.classList.add('open');o?.classList.add('on');d?.setAttribute('aria-hidden','false');o?.setAttribute('aria-hidden','false');if(document.body&&document.body.classList)document.body.classList.add('lock')}
function closeCart(){const d=$('.drawer'),o=$('.overlay');d?.classList.remove('open');o?.classList.remove('on');d?.setAttribute('aria-hidden','true');o?.setAttribute('aria-hidden','true');if(document.body&&document.body.classList&&!$('.mobilemenu.open')&&!$('.search.open'))document.body.classList.remove('lock')}
function renderCart(){
 const box=$('.cartbody');if(!box)return;
 let html='';
 if(window.__zaeviJustAdded){html+='<div class="cart-toast" role="status">Added to your bag</div>';window.__zaeviJustAdded=false}
 if(!cart.length){html+='<div class="cart-empty"><strong>Your bag is empty</strong><p>Discover the ZAEVI collection.</p><a class="arrow" href="collections.html">View the collection <b></b></a></div>'}
 else html+=cart.map((x,i)=>sizeRow(x,i)).join('');
 box.innerHTML=html;
 const total=cart.reduce((s,x)=>s+x.price*x.qty,0);if($('#total'))$('#total').textContent=money(total);
 $$('[data-remove]').forEach(b=>b.onclick=()=>removeAt(+b.dataset.remove));
 $$('[data-qty-dec]').forEach(b=>b.onclick=()=>changeQty(+b.dataset.qtyDec,-1));
 $$('[data-qty-inc]').forEach(b=>b.onclick=()=>changeQty(+b.dataset.qtyInc,1));
 $$('[data-size-select]').forEach(sel=>sel.onchange=()=>changeSize(+sel.dataset.sizeSelect,sel.value));
}
function sizeMeta(x){return x.qty+' × '+money(x.price)}
function sizeSelectUi(x,i){
 if(x.size)return '<div class="sizechip">SIZE '+escapeHtml(x.size)+'</div>';
 const p=products.find(q=>q.id===x.id);if(!p)return '';
 const sizes=productSizes(p);if(!sizes.length)return '';
 return '<select data-size-select="'+i+'" aria-label="Size for '+escapeHtml(p.name)+'">'+sizes.map(s=>'<option>'+escapeHtml(s)+'</option>').join('')+'</select>';
}
function sizeRow(x,i){
 return '<div class="cartrow"><div class="cartpic" style="background-image:url(\''+x.img+'\')"></div><div class="cartrow-info"><div class="cartname">'+escapeHtml(x.name)+'</div><div class="cartmeta">'+sizeMeta(x)+'</div>'+sizeSelectUi(x,i)+'<div class="qty-control" role="group" aria-label="Quantity for '+escapeHtml(x.name)+'"><button class="qty-btn" type="button" data-qty-dec="'+i+'" aria-label="Decrease quantity" '+(x.qty<=1?'disabled':'')+'>−</button><span class="qty-value" aria-live="polite">'+x.qty+'</span><button class="qty-btn" type="button" data-qty-inc="'+i+'" aria-label="Increase quantity" '+(x.qty>=10?'disabled':'')+'>+</button></div></div><button class="remove" type="button" data-remove="'+i+'" aria-label="Remove '+escapeHtml(x.name)+' from bag">×</button></div>';
}
function changeSize(i,size){
 const x=cart[i];if(!x||!size)return;
 const p=products.find(q=>q.id===x.id);if(!p)return;
 const s=resolveSize(p,size);if(!s||s===x.size)return;
 cart[i]=Object.assign({},x,{size:s});save();
}
function card(p){
 const liked=wishlist.includes(p.id);
 return `<article class="product reveal" data-cat="${escapeHtml(p.cat)}" data-name="${escapeHtml(p.name)}" data-price="${escapeHtml(p.price)}">
 <a href="product.html?id=${encodeURIComponent(p.id)}"><div class="product-img"><img class="p1" src="${escapeHtml(p.img)}" alt="" aria-hidden="true" loading="lazy"><img class="p2" src="${escapeHtml(p.hover)}" alt="" aria-hidden="true" loading="lazy"><span class="image-fallback" aria-hidden="true">Image unavailable</span><span class="badge">${+p.id.slice(-3)<=6?'NEW':'HOUSE EDIT'}</span></div><div class="meta"><span>${escapeHtml(p.name)}</span><span>${money(p.price)}</span></div><div class="sub">${escapeHtml(p.cat)} · ${escapeHtml(p.color)}</div></a>
 <button class="wish" type="button" data-wish="${escapeHtml(p.id)}" data-product-name="${escapeHtml(p.name)}" aria-label="${liked?'Remove':'Add'} ${escapeHtml(p.name)} ${liked?'from':'to'} wishlist" aria-pressed="${liked}"><span aria-hidden="true">${liked?'♥':'♡'}</span></button></article>`;
}
// Lets Site Studio sections show products with the same cards as the catalogue.
window.__zaeviStorefront={getProducts:()=>products,renderCards(grid,list){grid.innerHTML=list.map(card).join('');bindCards(grid);$$('.reveal',grid).forEach(x=>x.classList.add('in'))}};
function renderCatalog(){
 const grid=$('#catalogGrid');if(!grid)return;
 const gender=grid.dataset.gender||'All';
 let list=products.filter(p=>p.available!==false&&(gender==='All'||p.gender===gender||p.gender==='Unisex'));
 grid.innerHTML=list.map(card).join('');
 bindCards(grid);
 $$('.filter').forEach(b=>b.onclick=()=>{$$('.filter').forEach(x=>x.classList.remove('active'));b.classList.add('active');const f=b.dataset.filter;$$('.product',grid).forEach(c=>c.style.display=f==='All'||c.dataset.cat===f?'':'none')});
 $('#sort')?.addEventListener('change',e=>{let a=[...$$('.product',grid)],m=e.target.value;a.sort((x,y)=>m==='low'?+x.dataset.price-+y.dataset.price:m==='high'?+y.dataset.price-+x.dataset.price:m==='az'?x.dataset.name.localeCompare(y.dataset.name):0);a.forEach(x=>grid.appendChild(x))});
}
function bindCards(grid=document){
 $$('.product-img img',grid).forEach(image=>{
   const markUnavailable=()=>{
     image.hidden=true;
     const container=image.closest('.product-img');
     if(image.classList.contains('p1'))container?.classList.add('has-image-error');
     else container?.classList.add('has-hover-image-error');
   };
   image.addEventListener('error',markUnavailable,{once:true});
   if(image.complete&&image.naturalWidth===0)markUnavailable();
 });
 $$('[data-wish]',grid).forEach(b=>b.onclick=e=>{
   e.preventDefault();e.stopPropagation();
   const id=b.dataset.wish;
   toggleWish(id);
   const active=wishlist.includes(id);
   syncWishButton(b,id,b.dataset.productName);
   b.setAttribute('aria-pressed',String(active));
   b.setAttribute('aria-label',`${active?'Remove':'Add'} ${b.dataset.productName||id} ${active?'from':'to'} wishlist`);
   const icon=b.querySelector('[aria-hidden="true"]');
   if(icon)icon.textContent=active?'♥':'♡';
   const wg=$('#wishGrid');
   if(wg&&wg.contains(b)&&!active){b.closest('.product')?.remove();if(!$$('.product',wg).length)wg.innerHTML=WISH_EMPTY}
 });
}
function bindProductGallery(gallery){
 $$('.gallery-image img',gallery).forEach(image=>{
   const markUnavailable=()=>{
     image.hidden=true;
     const frame=image.closest('.gallery-image');
     if(!frame)return;
     frame.classList.add('has-image-error');
     if(!frame.classList.contains('gallery-image--primary'))frame.classList.add('is-omitted');
   };
   image.addEventListener('error',markUnavailable,{once:true});
   if(image.complete&&image.naturalWidth===0)markUnavailable();
 });
}
const HOME_LIMIT=8;
function renderHome(){
 const grid=$('#homeGrid');if(!grid||!products.length)return;
 grid.innerHTML=products.filter(p=>p.available!==false).slice(0,HOME_LIMIT).map(card).join('');
 bindCards(grid);
}
const WISH_EMPTY='<div class="empty-state"><strong>Your wishlist is empty</strong><p>Save pieces as you browse and they will appear here.</p><a class="button button--secondary" href="women.html">DISCOVER THE COLLECTION</a></div>';
function renderWishlist(){
 const grid=$('#wishGrid');if(!grid||!products.length)return;
 const list=(Array.isArray(wishlist)?wishlist:[]).map(id=>products.find(p=>p.id===id)).filter(Boolean);
 if(!list.length){grid.innerHTML=WISH_EMPTY;return}
 grid.innerHTML=list.map(card).join('');
 bindCards(grid);
}
function searchBody(){
 const overlay=$('.search');if(!overlay)return null;
 let box=overlay.querySelector('.search-results');
 if(!box){box=document.createElement('div');box.className='search-results product-grid';overlay.appendChild(box)}
 return box;
}
async function runSearch(q){
 const box=searchBody();if(!box)return;
 const seq=++searchSeq,query=q.trim().slice(0,100);
 if(!query){box.innerHTML='';return}
 box.innerHTML='<div class="eyebrow">SEARCHING…</div>';
 let list=null;
 try{const r=await fetch('/api/products?search='+encodeURIComponent(query)+'&limit=100');if(r.ok){const j=await r.json();if(j&&Array.isArray(j.data))list=j.data.length?(validApi(j.data)?j.data.map(toFront):null):[]}}catch(e){}
 if(list===null){try{const r=await fetch('products.json');if(r.ok){const j=await r.json();if(validFront(j)){const s=query.toLowerCase();list=j.filter(p=>((p.name||'')+' '+(p.desc||'')+' '+(p.color||'')).toLowerCase().includes(s))}}}catch(e){}}
 if(seq!==searchSeq)return;
 if(list===null){box.innerHTML='<div class="eyebrow">SEARCH UNAVAILABLE</div>';return}
 if(!list.length){box.innerHTML='<div class="eyebrow">NO RESULTS FOR &ldquo;'+query.replace(/[<&]/g,c=>c==='<'?'&lt;':'&amp;')+'&rdquo;</div>';return}
 box.innerHTML=list.map(card).join('');
 $$('.reveal',box).forEach(x=>x.classList.add('in'));
 bindCards(box);
}
function productNotice(d,title,copy){
 d.innerHTML='<div style="grid-column:1/-1;text-align:center;padding:60px 0"><div class="eyebrow">ZAEVI</div><h1 class="display">'+title+'</h1><p class="copy">'+copy+'</p><a class="arrow" href="collections.html">View the collection <b></b></a></div>';
}
function renderProduct(){
 const d=$('#productDetail');if(!d)return;
 const rawId=new URLSearchParams(location.search).get('id');
 if(!products.length){productNotice(d,'Product unavailable.','We cannot load this product right now. Please try again shortly.');return}
 let p;
 if(rawId){p=products.find(x=>x.id===rawId);if(!p){productNotice(d,'Product not found.','The piece you are looking for is unavailable or no longer part of the collection.');return}}
 else p=products.find(x=>x.id==='ZV002')||products[1]||products[0];
 if(!p){productNotice(d,'Product not found.','The piece you are looking for is unavailable or no longer part of the collection.');return}
 $('#pcode').textContent='ZAEVI / '+p.id;$('#pname').textContent=p.name;$('#pprice').textContent=money(p.price);$('#pdesc').textContent=p.desc;
 $('#gallery').innerHTML=`<div class="gallery-image gallery-image--primary"><img src="${escapeHtml(p.img)}" alt="${escapeHtml(p.name)}"><span class="gallery-fallback" aria-hidden="true">Image unavailable</span></div><div class="gallery-image"><img src="${escapeHtml(p.hover)}" alt="${escapeHtml(p.name)} alternate view"></div><div class="gallery-image"><img src="${escapeHtml(p.img)}" alt="" aria-hidden="true"></div>`;
 bindProductGallery($('#gallery'));
 const sizes=productSizes(p);
 $('#sizes').innerHTML=sizes.length?sizes.map(s=>'<button>'+escapeHtml(s)+'</button>').join(''):'';
 $$('#sizes button').forEach(b=>b.onclick=()=>{$$('#sizes button').forEach(x=>x.classList.remove('active'));b.classList.add('active')});
 if(!isSizeDependent(p)){const b=$('#sizes button');if(b)b.classList.add('active')}
 $('#addProduct').onclick=()=>{const sel=$('#sizes button.active');add(p.id,sel&&sel.textContent)};
 const pw=$('#pWish');
 if(pw){
  pw.dataset.wish=p.id;pw.dataset.productName=p.name;
  syncWishButton(pw,p.id,p.name);
  pw.onclick=e=>{if(e){e.preventDefault();e.stopPropagation()}toggleWish(p.id);syncWishButton(pw,p.id,p.name)};
 }
 sizeNotice('');
 document.title=p.name+' — ZAEVI';
  loadProductReviews(p.id);
  wireReviewForm(p.id);
}

// ============================================================
// Checkout — authenticated integration
// ============================================================

// Prevent duplicate submissions
let __zaeviCheckoutInProgress=false;

// Read the CSRF cookie (zaevi.csrf is non-HttpOnly, JS-accessible)
function getCsrfToken(){
  const cookies=document.cookie.split(';').map(c=>c.trim());
  for(const cookie of cookies){
    const [name,...valueParts]=cookie.split('=');
    if(name.trim()==='zaevi.csrf'){
      return valueParts.join('=');
    }
  }
  return null;
}

// Check authentication state
async function __zaeviCheckAuth(){
  try{
    const res=await fetch('/api/auth/me',{credentials:'same-origin'});
    const data=await res.json();
    return{authenticated:res.ok&&data.data!==null,data:data};
  }catch(e){return{authenticated:false}};
}

// Prepare headers for POST /api/orders.
// Includes x-csrf-token when authenticated (backend requires it for cookie-authenticated state-changing requests).
// For guest requests (no session), only Idempotency-Key is sent — backend exempts guests from CSRF.
async function __zaeviCheckoutHeaders(){
  const auth=await __zaeviCheckAuth();
  const csrf=getCsrfToken();
  const headers={'Content-Type':'application/json','Idempotency-Key':''}; // placeholder
  if(auth.authenticated&&csrf){
    headers['x-csrf-token']=csrf;
  }
  return{auth,headers};
}

// Submit checkout with auth-aware headers
async function zcSubmit(cart,fields,deps){
 deps=deps||{};
 if(!Array.isArray(cart))return{status:'error',message:'Our checkout is not available right now. Please try again shortly.'};
 if(!cart.length)return{status:'empty',message:'Your bag is empty.'};
 const need=zcMissingSize(cart);if(need)return{status:'missing-size',message:'Please choose a size for '+need.name+' before checkout.'};
 if(!zcValidEmail(zcStr(fields&&fields.email)))return{status:'malformed',message:'Please enter a valid email address.'};
 if(__zaeviCheckoutInProgress)return{status:'in-flight'};
 __zaeviCheckoutInProgress=true;
 // Get auth-aware headers (includes CSRF token if authenticated)
 const authHeaders=await __zaeviCheckoutHeaders();
 let idempotencyKey=zcGetIdempotencyKey();
 if(!idempotencyKey){idempotencyKey=zcGenerateIdempotencyKey();zcSetIdempotencyKey(idempotencyKey);}
 const payload=zcBuildPayload(cart,fields);
 // Freeze the submitted bag so the success path can remove exactly these
 // quantities from whatever the cart looks like when the response arrives.
 const snapshot=cart.slice();
 // Build headers: always include Idempotency-Key, add x-csrf-token if authenticated
 const headers={'Content-Type':'application/json','Idempotency-Key':idempotencyKey};
 if(authHeaders.auth&&authHeaders.headers['x-csrf-token']){
   headers['x-csrf-token']=authHeaders.headers['x-csrf-token'];
 }
 const settle=(code,res)=>{const out=zcHandleResponse(code,res,{deps,payload,idempotencyKey,snapshot});__zaeviCheckoutInProgress=false;return out};
 return fetch('/api/orders',{method:'POST',headers,body:JSON.stringify(payload)})
  .then(r=>Promise.resolve(r.json().catch(()=>null)).then(b=>settle(r.status,b)))
  .catch(()=>{__zaeviCheckoutInProgress=false;settle(0,null)});
}

// Wire checkout form with auth check
function zcWire(){
 try{zcRenderSummary()}catch(e){}
 const form=document.getElementById('checkoutForm');
 form?.addEventListener('submit',e=>{
   e.preventDefault();
   zcSubmit(zcReadCart(),zcFields(),{}).then(zcShow);
 });
}
zcWire();

// ============================================================
// Cart → checkout entry point (every storefront page).
// Restored: the drawer CHECKOUT button was left unwired (clicking did
// nothing). Account-first flow: a signed-out visitor goes to the account
// page with a validated return path; a failed session check shows a
// recoverable message and never assumes the customer is authenticated.
// ============================================================

// Accept only a same-origin relative page as the post-login return target.
// Absolute URLs, protocol-relative URLs, javascript:, traversal and non-page
// values are rejected so `next` can never be used as an open redirect.
function safeNextPath(path){
 if(typeof path!=='string')return null;
 const value=path.trim();
 if(!value)return null;
 if(value.startsWith('//'))return null;
 if(/^[a-z][a-z0-9+.-]*:/i.test(value))return null;
 if(value.includes('\\')||value.includes('..'))return null;
 if(!/\.html($|[?#])/.test(value))return null;
 return value;
}

// Read a validated `next` query parameter from the current URL.
function nextAfterLogin(){
 try{
   const params=new URLSearchParams(location.search||'');
   return safeNextPath(params.get('next'));
 }catch(e){
   return null;
 }
}

// A validated, same-origin return target for the account page. `next` is
// re-checked through safeNextPath so an attacker cannot smuggle an absolute
// URL in via a link.
function accountNextUrl(page){
 const next=safeNextPath(page||'checkout.html')||'checkout.html';
 return 'account.html?next='+encodeURIComponent(next);
}

// Resolve the raw checkAuth() result. The server answers `200 {data:null}`
// for a signed-out visitor, so a body without a `data` key (a network failure
// or an error response) means the check itself failed — never "signed out".
// The distinction drives every fail-closed decision below.
function classifyAuthResult(result){
 if(!result)return 'error';
 const body=result.data;
 if(!body||body.data===undefined)return 'error';
 return result.authenticated?'authenticated':'anonymous';
}

// Shared signal: resolves when the authoritative session check started by
// renderAuthUI settles, so the cart Checkout entry point and the checkout page
// gate wait for the existing initialization instead of racing it (and instead
// of issuing a second GET /api/auth/me per page load).
let authSettleResolve=null;
window.__zaeviAuthSettled=new Promise(function(resolve){authSettleResolve=resolve});
function markAuthSettled(result){
 if(typeof authSettleResolve==='function'){
   const resolve=authSettleResolve;
   authSettleResolve=null;
   resolve(result);
 }
}

// Redirect to a validated `next` target after a successful sign-in / sign-up.
// Returns true when a redirect was issued so callers can stop re-rendering.
function afterAuthRedirect(){
 const next=nextAfterLogin();
 if(!next)return false;
 try{location.href=next}catch(e){return false}
 return true;
}

function checkoutErrorElement(){
 let node=document.getElementById('checkoutAuthError');
 if(node)return node;
 const btn=$('.drawer .checkout');
 if(!btn||!btn.parentNode)return null;
 node=document.createElement('p');
 node.id='checkoutAuthError';
 node.setAttribute('role','alert');
 node.hidden=true;
 node.style.cssText='color:var(--danger);font-size:11px;line-height:1.6;margin:12px 0 0';
 btn.parentNode.insertBefore(node,btn.nextSibling);
 return node;
}
function showCheckoutError(message){
 const node=checkoutErrorElement();
 if(!node)return;
 node.textContent=message||'';
 node.hidden=!message;
}
function checkoutDestination(state){
 if(state==='authenticated')return 'checkout.html';
 if(state==='anonymous')return accountNextUrl('checkout.html');
 return null;
}
function wireCheckoutButtons(){
 $$('.drawer .checkout').forEach(function(btn){
   if(btn.__zaeviCheckoutWired)return;
   btn.__zaeviCheckoutWired=true;
   // A legacy inline onclick (if still present) must never fire alongside
   // this handler, so it is removed before the listener is attached.
   if(typeof btn.getAttribute==='function'&&btn.getAttribute('onclick'))btn.removeAttribute('onclick');
   btn.addEventListener('click',function(event){
     if(event&&typeof event.preventDefault==='function')event.preventDefault();
     showCheckoutError('');
     const settled=window.__zaeviAuthSettled;
     const pending=(settled&&typeof settled.then==='function')?settled:checkAuth();
     Promise.resolve(pending).then(function(result){
       const destination=checkoutDestination(classifyAuthResult(result));
       if(!destination){
         showCheckoutError('We could not verify your sign-in. Please check your connection and try again.');
         return;
       }
       location.href=destination;
     }).catch(function(){
       showCheckoutError('We could not verify your sign-in. Please check your connection and try again.');
     });
   });
 });
}

// ============================================================
// Authentication & Session — frontend integration (continued)
// Uses the existing backend APIs: POST /api/auth/login,
// POST /api/auth/register, POST /api/auth/logout, GET /api/auth/me.
// CSRF: reads zaevi.csrf cookie (non-HttpOnly) and sends
//      x-csrf-token header for state-changing requests.
// Never trusts client-side state as proof of authentication;
// the server session remains authoritative.
// ============================================================

// Check authentication state by fetching GET /api/auth/me
async function checkAuth(){
  try{
    const res=await fetch('/api/auth/me',{credentials:'same-origin'});
    const data=await res.json();
    return{authenticated:res.ok&&data.data!==null,data:data};
  }catch(e){return{authenticated:false}};
}
async function login(email,password){
  if(window.__zaeviLoginInProgress)return false;
  window.__zaeviLoginInProgress=true;
  try{
    const res=await fetch('/api/auth/login',{
      method:'POST',
      credentials:'same-origin',
      headers:{'Content-Type':'application/json','x-csrf-token':window.__zaeviCsrfToken||''},
      body:JSON.stringify({email,password})
    });
    const data=await res.json().catch(()=>({}));
    if(res.ok&&data.data){
      const csrf=document.cookie.split(';').find(c=>c.startsWith('zaevi.csrf='));
      if(csrf)window.__zaeviCsrfToken=csrf.split('=')[1];
    }
    return{status:res.status,data,error:data.error||null};
  }catch(e){
  return{status:0,error:e.message||'Network error'}}finally{
    window.__zaeviLoginInProgress=false;
  }
}
async function register(name,email,phone,password){
  if(window.__zaeviRegisterInProgress)return false;
  window.__zaeviRegisterInProgress=true;
  try{
    const res=await fetch('/api/auth/register',{
      method:'POST',
      credentials:'same-origin',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({name,email,phone,password})
    });
    const data=await res.json().catch(()=>({}));
    return{status:res.status,data,error:data.error||null};
  }catch(e){
  return{status:0,error:e.message||'Network error'}}finally{
    window.__zaeviRegisterInProgress=false;
  }
}
// Confirmation message shown when the customer clicks the LOGOUT control.
// The native confirm() popup is used deliberately: no project-specific modal
// exists client-side, and it keeps the flow synchronous and simple.
const LOGOUT_CONFIRM_MESSAGE='Are you sure you want to logout?';

// Click handler for the LOGOUT button. Asks for confirmation first and calls
// the existing logout() only when the customer confirms. Cancelling closes the
// popup and never touches the session or the authenticated UI. The
// __zaeviLogoutInProgress guard (inside logout()) additionally prevents a
// second popup/API request while a logout is already running.
function confirmLogout(){
  if(window.__zaeviLogoutInProgress)return false;
  let confirmed=false;
  try{confirmed=window.confirm(LOGOUT_CONFIRM_MESSAGE);}catch(e){confirmed=false;}
  if(!confirmed)return false;
  logout();
  return true;
}

// POST the logout request, then sync client state ONLY on a definitive server
// answer. Transport failures and 403/5xx keep the authenticated view (the
// session may still be alive server-side) and surface an error next to the
// button instead of silently flipping the customer to the sign-in view — the
// old unconditional finally block did exactly that, which made a failed
// logout LOOK like the button did nothing.
async function logout(){
  if(window.__zaeviLogoutInProgress)return{status:-1,inProgress:true};
  window.__zaeviLogoutInProgress=true;
  try{
    const csrf=getCsrfToken();
    const res=await fetch('/api/auth/logout',{
      method:'POST',
      credentials:'same-origin',
      headers:{'Content-Type':'application/json','x-csrf-token':csrf||''}
    });
    const data=await res.json().catch(()=>({}));
    if(res.status===200){
      window.__zaeviAuth=window.__zaeviAuth||{};
      window.__zaeviAuth.authenticated=false;
      window.__zaeviAuth.profile=null;
      stopAccountPolling();
      window.__zaeviAccountState=null;
      // One-shot success notice for the freshly rendered sign-in view.
      window.__zaeviLogoutNotice='You have been logged out.';
      renderAuthUI();
      return{status:res.status,data};
    }
    if(res.status===401){
      // The server reports no live session (e.g. it already expired). The
      // customer is definitively signed out, so sync the state here too.
      window.__zaeviAuth=window.__zaeviAuth||{};
      window.__zaeviAuth.authenticated=false;
      window.__zaeviAuth.profile=null;
      stopAccountPolling();
      window.__zaeviAccountState=null;
      window.__zaeviLogoutNotice='Your session has ended. Please sign in again.';
      renderAuthUI();
      return{status:res.status,data};
    }
    showLogoutStatus((data&&data.error&&data.error.message)||'Could not log you out. Please check your connection and try again.',true);
    return{status:res.status,data,error:(data&&data.error)||null};
  }catch(e){
    showLogoutStatus((e&&e.message)?e.message:'Could not log you out. Please check your connection and try again.',true);
    return{status:0,error:e.message||'Network error'};
  }finally{
    window.__zaeviLogoutInProgress=false;
  }
}

// Render (or update) the status line that renderLogoutButton places directly
// under the LOGOUT control. Any re-render of the account section wipes it.
function showLogoutStatus(message,isError){
  const section=document.querySelector('.zveiauth');
  if(!section)return;
  let node=document.getElementById('logoutStatus');
  if(!node){
    node=document.createElement('p');
    node.id='logoutStatus';
    node.setAttribute('role','alert');
    node.style.cssText='font-size:11px;margin-top:8px;min-height:14px';
    const btn=section.querySelector('.logout-btn');
    if(btn&&btn.parentNode)btn.parentNode.insertBefore(node,btn.nextSibling);
    else section.appendChild(node);
  }
  node.style.color=isError?'var(--danger)':'var(--success)';
  node.textContent=message||'';
}
// ============================================================
// Premium customer account portal
// ------------------------------------------------------------
// The portal is rendered into the existing `.zveiauth` section. It reads only
// the existing session/order/address APIs and never invents a payment, carrier,
// delivery event or status timestamp. Active/completed/cancelled groups are
// derived from the authoritative `Order.status` workflow.
// ============================================================

const ACCOUNT_ACTIVE_STATUSES=Object.freeze(['pending','confirmed','in_production','quality_check','packed','shipped']);
const ACCOUNT_WORKFLOW=Object.freeze([
  {value:'pending',label:'Order Received'},
  {value:'confirmed',label:'Confirmed'},
  {value:'in_production',label:'In Production'},
  {value:'quality_check',label:'Quality Check'},
  {value:'packed',label:'Packed'},
  {value:'shipped',label:'Shipped'},
  {value:'delivered',label:'Delivered'},
]);
const ACCOUNT_TABS=Object.freeze([
  {id:'overview',label:'Home'},
  {id:'orders',label:'My Orders'},
  {id:'track',label:'Track Order'},
  {id:'addresses',label:'Addresses'},
  {id:'details',label:'My Details'},{id:'payments',label:'Payments'},
]);
const ACCOUNT_FILTERS=Object.freeze([
  {id:'all',label:'All Orders'},
  {id:'active',label:'Active'},
  {id:'completed',label:'Completed'},
  {id:'cancelled',label:'Cancelled'},
  {id:'returns',label:'Returns & Replacements'},
]);
let accountPollTimer=null;

function accountGroup(status){
  if(status==='delivered')return 'completed';
  if(status==='cancelled')return 'cancelled';
  return 'active';
}
function accountStatusLabel(o){
  return (o&&o.statusLabel)||orderStatusLabel(o&&o.status);
}
function accountTimeline(o){
  if(o&&Array.isArray(o.timeline)&&o.timeline.length)return o.timeline;
  const status=o&&o.status;
  if(status==='cancelled')return [{value:'cancelled',label:'Cancelled',state:'current'}];
  const idx=ACCOUNT_WORKFLOW.findIndex(s=>s.value===status);
  if(idx<0)return [{value:status,label:accountStatusLabel(o),state:'current'}];
  return ACCOUNT_WORKFLOW.map((s,i)=>({value:s.value,label:s.label,state:i<idx?'complete':i===idx?'current':'upcoming'}));
}
function moneyMinor(minor){
  return money((Number(minor)||0)/100);
}
function accountDate(value,withTime){
  if(!value)return '';
  const d=new Date(value);
  if(isNaN(d.getTime()))return '';
  const date=d.toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'});
  if(!withTime)return date;
  return date+', '+d.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'});
}
function accountGreeting(){
  const h=new Date().getHours();
  if(h<12)return 'Good morning';
  if(h<17)return 'Good afternoon';
  return 'Good evening';
}
function accountInitial(item){
  const source=(item&&(item.productName||item.name))||'ZAEVI';
  return escapeHtml(String(source).trim().charAt(0).toUpperCase()||'Z');
}
function accountProductFor(item){
  if(!item||!item.productId)return null;
  return products.find(p=>p.id===item.productId)||null;
}
function accountThumb(item){
  const p=accountProductFor(item);
  const url=p&&p.imageUrl?p.imageUrl:'';
  if(url)return '<span class="acct-thumb"><img src="'+escapeHtml(url)+'" alt="" loading="lazy"></span>';
  return '<span class="acct-thumb acct-thumb--fallback" aria-hidden="true">'+accountInitial(item)+'</span>';
}
function accountItemNames(items){
  const names=(items||[]).map(i=>i&&i.productName).filter(Boolean);
  if(!names.length)return 'ZAEVI order';
  if(names.length===1)return names[0];
  return names[0]+' + '+(names.length-1)+' more';
}
function accountTotalQty(items){
  return (items||[]).reduce((sum,i)=>sum+(Number(i&&i.quantity)||0),0);
}
function accountStatusPill(o){
  const group=accountGroup(o&&o.status);
  return '<span class="acct-pill is-'+group+'">'+escapeHtml(accountStatusLabel(o))+'</span>';
}
function accountDeliveryEstimate(o){
  const status=o&&o.status;
  if(status==='cancelled')return 'This order was cancelled. No further delivery updates will be made.';
  if(status==='delivered')return 'Delivered. A delivery date is not recorded for this order.';
  if(status==='shipped')return 'Dispatched. Carrier and tracking details are not yet available.';
  return 'Delivery estimate will be updated after order confirmation.';
}
function accountTimelineHtml(o){
  const stages=accountTimeline(o);
  return '<ol class="acct-timeline">'+stages.map((stage,index)=>{
    const state=stage.state||'upcoming';
    const meta=index===0&&o&&o.createdAt
      ? 'Placed '+accountDate(o.createdAt)
      : state==='current' ? 'Current stage' : '';
    return '<li class="acct-step is-'+escapeHtml(state)+'">'
      +'<span class="acct-dot" aria-hidden="true"></span>'
      +'<div class="acct-step-copy"><span class="acct-step-label">'+escapeHtml(stage.label)+'</span>'
      +(meta?'<span class="acct-step-meta">'+escapeHtml(meta)+'</span>':'')
      +'</div></li>';
  }).join('')+'</ol>';
}
function accountOrderCard(o){
  const items=(o&&o.items)||[];
  const ref=String((o&&o.reference)||'');
  const thumbs=items.slice(0,3).map(accountThumb).join('')
    +(items.length>3?'<span class="acct-thumb acct-thumb--more">+'+(items.length-3)+'</span>':'');
  const sizes=[...new Set(items.map(i=>i&&i.size).filter(Boolean))];
  const qty=accountTotalQty(items);
  return '<article class="acct-order-card" data-order-open="'+escapeHtml(ref)+'" tabindex="0" role="button" aria-label="View order '+escapeHtml(ref)+'">'
    +'<div class="acct-order-thumbs">'+(thumbs||'<span class="acct-thumb acct-thumb--fallback">Z</span>')+'</div>'
    +'<div class="acct-order-main">'
    +'<div class="acct-order-kicker"><span class="acct-ref">'+escapeHtml(ref)+'</span>'+accountStatusPill(o)+'</div>'
    +'<h3>'+escapeHtml(accountItemNames(items))+'</h3>'
    +'<p class="acct-order-meta">'+(qty?qty+' item'+(qty===1?'':'s'):'No items')+(sizes.length?' · Size '+escapeHtml(sizes.join(', ')):'')+'</p>'
    +'<p class="acct-order-date">Placed '+escapeHtml(accountDate(o&&o.createdAt))+'</p>'
    +'</div>'
    +'<div class="acct-order-side"><span class="acct-total">'+moneyMinor(o&&o.totalMinor)+'</span><span class="acct-view">View details <b>→</b></span></div>'
    +'</article>';
}
function accountEmpty(title,copy,action){
  return '<div class="acct-empty"><div class="acct-empty-mark" aria-hidden="true">Z</div><h3>'+escapeHtml(title)+'</h3><p>'+escapeHtml(copy)+'</p>'+(action||'')+'</div>';
}
function accountTabsHtml(st){
  return '<nav class="acct-nav" role="tablist" aria-label="Account sections">'+ACCOUNT_TABS.map(tab=>{
    const selected=st.tab===tab.id||(tab.id==='orders'&&st.tab==='order');
    return '<button type="button" class="acct-nav-item'+(selected?' is-active':'')+'" role="tab" aria-selected="'+(selected?'true':'false')+'" data-account-tab="'+tab.id+'">'+escapeHtml(tab.label)+'</button>';
  }).join('')+'</nav>';
}
function accountOverviewHtml(st){
  const active=st.orders.filter(o=>accountGroup(o.status)==='active');
  const completed=st.orders.filter(o=>accountGroup(o.status)==='completed');
  const cancelled=st.orders.filter(o=>accountGroup(o.status)==='cancelled');
  const updates=[...st.orders].sort((a,b)=>new Date(b.updatedAt||b.createdAt||0)-new Date(a.updatedAt||a.createdAt||0)).slice(0,4);
  return '<section class="acct-panel acct-overview">'
    +'<div class="acct-quick">'
    +'<button type="button" class="acct-quick-card" data-account-tab="orders"><strong>My orders</strong><span>See, cancel or return an order</span></button>'
    +'<button type="button" class="acct-quick-card" data-account-tab="track"><strong>Track an order</strong><span>Where is my order now?</span></button>'
    +'<button type="button" class="acct-quick-card" data-account-tab="addresses"><strong>Addresses</strong><span>Add or change where we deliver</span></button>'
    +'<a class="acct-quick-card" href="contact.html"><strong>Get help</strong><span>Send us a message</span></a>'
    +'</div>'
    +'<div class="acct-stats">'
    +'<div class="acct-stat"><span class="acct-stat-num">'+active.length+'</span><span class="acct-stat-label">Active orders</span></div>'
    +'<div class="acct-stat"><span class="acct-stat-num">'+completed.length+'</span><span class="acct-stat-label">Completed</span></div>'
    +'<div class="acct-stat"><span class="acct-stat-num">'+st.orders.length+'</span><span class="acct-stat-label">Total orders</span></div>'
    +'</div>'
    +'<div class="acct-columns">'
    +'<div class="acct-column-main">'
    +'<div class="acct-section-head"><div><div class="eyebrow">IN PROGRESS</div><h2>Active orders</h2></div><button type="button" class="acct-textlink" data-account-tab="orders">View all orders</button></div>'
    +(active.length?active.slice(0,3).map(accountOrderCard).join(''):accountEmpty('No active orders','When you place an order, its progress will appear here.','<a class="acct-textlink" href="women.html">Explore the collection</a>'))
    +'</div>'
    +'<aside class="acct-column-side">'
    +'<div class="acct-section-head"><div><div class="eyebrow">LATEST</div><h2>Recent updates</h2></div></div>'
    +(updates.length?'<div class="acct-updates">'+updates.map(o=>'<div class="acct-update"><div class="acct-update-top">'+accountStatusPill(o)+'<span>'+escapeHtml(accountDate(o.updatedAt||o.createdAt))+'</span></div><strong>'+escapeHtml(o.reference||'')+'</strong><p>'+escapeHtml(accountItemNames(o.items))+'</p></div>').join('')+'</div>':accountEmpty('No updates yet','Updates will appear here as your order moves along.',''))
    +'</aside>'
    +'</div></section>';
}
function accountOrdersHtml(st){
  const filter=st.filter||'all';
  const filtered=filter==='all'?st.orders:st.orders.filter(o=>accountGroup(o.status)===filter);
  const counts={all:st.orders.length,active:st.orders.filter(o=>accountGroup(o.status)==='active').length,completed:st.orders.filter(o=>accountGroup(o.status)==='completed').length,cancelled:st.orders.filter(o=>accountGroup(o.status)==='cancelled').length};
  const filterHtml='<div class="acct-filters" role="group" aria-label="Filter orders">'+ACCOUNT_FILTERS.map(f=>{
    const count=f.id==='returns'?null:counts[f.id];
    return '<button type="button" class="acct-filter'+(filter===f.id?' is-active':'')+'" data-account-filter="'+f.id+'" aria-pressed="'+(filter===f.id?'true':'false')+'">'+escapeHtml(f.label)+(count==null?'':' <span>'+count+'</span>')+'</button>';
  }).join('')+'</div>';
  if(filter==='returns'){
    return '<section class="acct-panel"><div class="acct-section-head"><div><div class="eyebrow">MY ORDERS</div><h2>Returns &amp; replacements</h2></div></div>'+filterHtml
      +accountEmpty('Returns and replacements','To return or replace something, open a delivered order under All Orders. You have 14 days from delivery. For anything else, contact us.','<a class="acct-textlink" href="contact.html">Contact Client Services</a>')+'</section>';
  }
  return '<section class="acct-panel"><div class="acct-section-head"><div><div class="eyebrow">MY ORDERS</div><h2>Order history</h2></div><span class="acct-count">'+filtered.length+' order'+(filtered.length===1?'':'s')+'</span></div>'
    +filterHtml
    +(filtered.length?filtered.map(accountOrderCard).join(''):accountEmpty(filter==='all'?'No orders yet':'No '+filter+' orders','Your ZAEVI orders will appear here once they are placed.','<a class="acct-textlink" href="women.html">Explore the collection</a>'))
    +'</section>';
}
function accountTrackHtml(st){
  const active=st.orders.filter(o=>accountGroup(o.status)==='active');
  return '<section class="acct-panel"><div class="acct-section-head"><div><div class="eyebrow">TRACK ORDER</div><h2>Atelier progress</h2><p class="acct-lede">The stages below come directly from your order record. Completed stages do not carry a timestamp until stage history is recorded.</p></div></div>'
    +(active.length?active.map(o=>'<article class="acct-track-card"><div class="acct-track-head"><div><span class="acct-ref">'+escapeHtml(o.reference||'')+'</span><h3>'+escapeHtml(accountItemNames(o.items))+'</h3></div>'+accountStatusPill(o)+'</div>'
      +accountTimelineHtml(o)
      +'<p class="acct-note">'+escapeHtml(accountDeliveryEstimate(o))+'</p>'
      +'<div class="acct-track-actions"><button type="button" class="acct-textlink" data-order-open="'+escapeHtml(o.reference||'')+'">View order details</button><a class="acct-textlink" href="track.html?ref='+encodeURIComponent(o.reference||'')+'">Open public tracking</a></div>'
      +'</article>').join(''):accountEmpty('No active orders to track','Completed and cancelled orders remain available in My Orders.','<button type="button" class="acct-textlink" data-account-tab="orders">View order history</button>'))
    +'</section>';
}
function accountAddressesHtml(st){
  if(st.addressForm){
    const v=st.addressForm.values||{};
    const editing=st.addressForm.mode==='edit';
    const field=(name,label,opts)=>{
      opts=opts||{};
      const value=v[name]==null?'':String(v[name]);
      const required=opts.required?' required':'';
      const type=opts.type||'text';
      const autocomplete=opts.autocomplete?' autocomplete="'+opts.autocomplete+'"':'';
      return '<label class="acct-field"><span>'+escapeHtml(label)+'</span><input type="'+type+'" name="'+name+'" value="'+escapeHtml(value)+'"'+required+autocomplete+'></label>';
    };
    return '<section class="acct-panel"><div class="acct-section-head"><div><div class="eyebrow">ADDRESSES</div><h2>'+(editing?'Edit address':'Add an address')+'</h2></div><button type="button" class="acct-textlink" data-address-cancel>Cancel</button></div>'
      +'<form id="addressForm" class="acct-form" novalidate>'
      +'<div class="acct-form-grid">'
      +field('label','Label (Home, Work)')
      +field('fullName','Full name',{required:true,autocomplete:'name'})
      +field('phone','Phone',{required:true,autocomplete:'tel'})
      +field('addressLine1','Address line 1',{required:true,autocomplete:'address-line1'})
      +field('addressLine2','Address line 2',{autocomplete:'address-line2'})
      +field('city','City',{required:true,autocomplete:'address-level2'})
      +field('state','State',{required:true,autocomplete:'address-level1'})
      +field('postalCode','PIN code',{required:true,autocomplete:'postal-code'})
      +field('country','Country',{required:true,autocomplete:'country'})
      +'</div>'
      +'<label class="acct-check"><input type="checkbox" name="isDefault"'+(v.isDefault?' checked':'')+'> <span>Set as default delivery address</span></label>'
      +'<p class="acct-form-error" role="alert">'+escapeHtml(st.addressError||'')+'</p>'
      +'<div class="acct-form-actions"><button type="submit" class="add">'+(editing?'SAVE CHANGES':'SAVE ADDRESS')+'</button></div>'
      +'</form></section>';
  }
  const list=st.addresses||[];
  return '<section class="acct-panel"><div class="acct-section-head"><div><div class="eyebrow">ADDRESSES</div><h2>Delivery addresses</h2></div><button type="button" class="acct-textlink" data-address-add>Add address</button></div>'
    +(st.notice?'<p class="acct-notice" role="status">'+escapeHtml(st.notice)+'</p>':'')
    +(st.addressError?'<p class="acct-form-error" role="alert">'+escapeHtml(st.addressError)+'</p>':'')
    +(list.length?'<div class="acct-address-grid">'+list.map(a=>'<article class="acct-address'+(a.isDefault?' is-default':'')+'"><div class="acct-address-top"><strong>'+escapeHtml(a.label||a.fullName||'Address')+'</strong>'+(a.isDefault?'<span class="acct-pill is-active">Default</span>':'')+'</div><p>'+escapeHtml(a.fullName||'')+'</p><p>'+escapeHtml([a.addressLine1,a.addressLine2].filter(Boolean).join(', '))+'</p><p>'+escapeHtml([a.city,a.state,a.postalCode].filter(Boolean).join(', '))+'</p><p>'+escapeHtml(a.country||'')+'</p><p class="acct-address-phone">'+escapeHtml(a.phone||'')+'</p><div class="acct-address-actions"><button type="button" class="acct-textlink" data-address-edit="'+a.id+'">Edit</button>'+(a.isDefault?'':'<button type="button" class="acct-textlink" data-address-default="'+a.id+'">Make default</button>')+'<button type="button" class="acct-textlink is-danger" data-address-delete="'+a.id+'">Remove</button></div></article>').join('')+'</div>'
      :accountEmpty('No saved addresses','Add a delivery address to make future checkouts faster.','<button type="button" class="acct-textlink" data-address-add>Add your first address</button>'))
    +'<p class="acct-note">Addresses saved here are used at checkout. Historical orders keep the address captured when they were placed.</p>'
    +'</section>';
}
function accountDetailsHtml(st){
  const p=st.profile||{};
  const row=(label,value)=>'<div class="acct-detail-row"><span>'+escapeHtml(label)+'</span><strong>'+escapeHtml(value||'Not provided')+'</strong></div>';
  return '<section class="acct-panel"><div class="acct-section-head"><div><div class="eyebrow">ACCOUNT DETAILS</div><h2>Your information</h2></div></div>'
    +'<div class="acct-detail-list">'
    +row('Name',p.name)
    +row('Email',p.email)
    +row('Phone',p.phone)
    +row('Member since',accountDate(p.createdAt))
    +'</div>'
    +'<div class="acct-detail-note"><h3>Profile changes</h3><p>Name, email and password changes are handled personally by Client Services so your account and order records stay consistent.</p><a class="acct-textlink" href="contact.html">Contact Client Services</a></div>'
    +'</section>';
}
const ACCOUNT_REQUEST_LABELS={pending:'Waiting for our reply',approved:'Approved',rejected:'Declined',received:'Received',in_transit:'On its way back',shipped:'On its way',delivered:'Delivered',completed:'Completed',refunded:'Refunded',processed:'Refund sent',not_applicable:''};
function accountRequestLabel(value){
  const key=String(value||'');
  if(Object.prototype.hasOwnProperty.call(ACCOUNT_REQUEST_LABELS,key))return ACCOUNT_REQUEST_LABELS[key];
  return key.replace(/_/g,' ').replace(/^./,c=>c.toUpperCase());
}
function accountOrderDetailHtml(st){
  if(st.detailLoading)return '<section class="acct-panel"><p class="acct-loading" role="status">Loading order details…</p></section>';
  if(st.detailError)return '<section class="acct-panel"><div class="acct-section-head"><button type="button" class="acct-textlink" data-account-tab="orders">← Back to orders</button></div>'+accountEmpty('We could not load this order',st.detailError,'<button type="button" class="acct-textlink" data-order-open="'+escapeHtml(st.detailRef||'')+'">Try again</button>')+'</section>';
  const o=st.detail;
  if(!o||o.reference!==st.detailRef)return '<section class="acct-panel"><div class="acct-section-head"><button type="button" class="acct-textlink" data-account-tab="orders">← Back to orders</button></div>'+accountEmpty('Order not found','This order is not available in your account.','')+'</section>';
  const items=o.items||[];
  const shipping=o.shipping||{};
  const subtotal=Number(o.subtotalMinor)||0;
  const total=Number(o.totalMinor)||0;
  const shippingMinor=Math.max(0,total-subtotal);
  const discountMinor=Math.max(0,subtotal-total);
  const address=[shipping.name,shipping.address,shipping.city,shipping.state,shipping.postalCode,shipping.country].filter(Boolean);
  return '<section class="acct-panel acct-detail">'
    +'<div class="acct-section-head"><button type="button" class="acct-textlink" data-account-tab="orders">← Back to orders</button></div>'
    +(st.notice?'<p class="acct-notice" role="status">'+escapeHtml(st.notice)+'</p>':'')
    +(st.addressError?'<p class="acct-form-error" role="alert">'+escapeHtml(st.addressError)+'</p>':'')
    +'<div class="acct-detail-head"><div><div class="eyebrow">ORDER '+escapeHtml(o.reference||'')+'</div><h2>Order details</h2><p class="acct-order-date">Placed '+escapeHtml(accountDate(o.createdAt,true))+'</p></div>'+accountStatusPill(o)+'</div>'
    +'<div class="acct-detail-grid">'
    +'<div class="acct-detail-block"><h3>Progress</h3>'+accountTimelineHtml(o)+'<p class="acct-note">Last updated '+escapeHtml(accountDate(o.updatedAt||o.createdAt,true))+'</p></div>'
    +'<div class="acct-detail-block"><h3>Delivery</h3><p class="acct-address-lines">'+(address.length?address.map(escapeHtml).join('<br>'):'No delivery address recorded.')+'</p><p class="acct-note">'+escapeHtml(accountDeliveryEstimate(o))+'</p><p class="acct-note">Tracking details will appear here once your order ships.</p></div>'
    +'</div>'
    +'<div class="acct-detail-block"><h3>Items</h3><div class="acct-items">'+items.map(i=>'<div class="acct-item">'+accountThumb(i)+'<div class="acct-item-info"><strong>'+escapeHtml(i.productName||'ZAEVI piece')+'</strong><span>'+escapeHtml(i.productSku||'—')+(i.size?' · Size '+escapeHtml(i.size):'')+'</span><span>Qty '+escapeHtml(i.quantity)+' × '+moneyMinor(i.unitPriceMinor)+'</span></div><div class="acct-item-total">'+moneyMinor(i.lineTotalMinor)+'</div></div>').join('')+'</div></div>'
    +'<div class="acct-detail-grid">'
    +'<div class="acct-detail-block"><h3>Summary</h3><div class="acct-summary"><div><span>Subtotal</span><span>'+moneyMinor(subtotal)+'</span></div><div><span>Shipping</span><span>'+(shippingMinor?moneyMinor(shippingMinor):'Included')+'</span></div><div><span>Discounts</span><span>'+(discountMinor?'− '+moneyMinor(discountMinor):'None')+'</span></div><div class="acct-summary-total"><span>Total</span><span>'+moneyMinor(total)+'</span></div></div></div>'
    +'<div class="acct-detail-block"><h3>Payment</h3><p class="acct-note">See the Payments tab for anything you have paid.</p><p class="acct-note">Need help with this order? Contact us with your order reference.</p></div>'
    +'</div>'
    + (Array.isArray(o.statusHistory)&&o.statusHistory.length?'<div class="acct-detail-block"><h3>Status history</h3><ol class="acct-history">'+o.statusHistory.map(h=>'<li><span class="acct-step-meta">'+escapeHtml(accountDate(h.createdAt,true))+'</span> <strong>'+escapeHtml(h.previousStatus?orderStatusLabel(h.previousStatus)+' → ':'')+escapeHtml(orderStatusLabel(h.newStatus))+'</strong>'+(h.note&&h.visibility!=='internal'?'<p class="acct-note">'+escapeHtml(h.note)+'</p>':'')+'</li>').join('')+'</ol></div>':'')
    + (Array.isArray(o.shipments)&&o.shipments.length?'<div class="acct-detail-block"><h3>Shipment</h3>'+o.shipments.map(sh=>'<p class="acct-address-lines">'+escapeHtml(sh.carrier||'Carrier pending')+(sh.trackingNumber?' · '+escapeHtml(sh.trackingNumber):'')+'</p>'+(sh.trackingUrl?'<p><a class="acct-textlink" href="'+escapeHtml(sh.trackingUrl)+'" target="_blank" rel="noopener">Track with carrier</a></p>':'')+'<p class="acct-note">Dispatched: '+(sh.dispatchedAt?escapeHtml(accountDate(sh.dispatchedAt,true)):'not yet')+' · Delivered: '+(sh.deliveredAt?escapeHtml(accountDate(sh.deliveredAt,true)):'not yet')+'</p>').join('')+'</div>':'')
    + (o.cancellationRequest?'<div class="acct-detail-block"><h3>Cancellation request</h3><p class="acct-note">'+escapeHtml(accountRequestLabel(o.cancellationRequest.status))+(o.cancellationRequest.reason?' · '+escapeHtml(o.cancellationRequest.reason):'')+'</p></div>':'')
    + (Array.isArray(o.returnRequests)&&o.returnRequests.length?'<div class="acct-detail-block"><h3>Returns</h3>'+o.returnRequests.map(r=>'<p class="acct-note">'+escapeHtml(accountRequestLabel(r.status))+(accountRequestLabel(r.refundStatus)?' · Refund: '+escapeHtml(accountRequestLabel(r.refundStatus)):'')+'</p>').join('')+'</div>':'')
    + (Array.isArray(o.replacementRequests)&&o.replacementRequests.length?'<div class="acct-detail-block"><h3>Replacements</h3>'+o.replacementRequests.map(r=>'<p class="acct-note">'+escapeHtml(accountRequestLabel(r.status))+'</p>').join('')+'</div>':'')
    + (o.status==='pending'?'<div class="acct-detail-block"><h3>Cancellation</h3><p class="acct-note">This order can be cancelled now.</p><button type="button" class="button button--secondary" data-cancel-direct="'+escapeHtml(o.reference||'')+'">CANCEL ORDER</button></div>':'')
    + (['confirmed','in_production','quality_check','packed'].indexOf(o.status)!==-1&&!o.cancellationRequest?'<details class="acct-detail-block acct-fold"><summary>Ask to cancel this order</summary><form id="cancelRequestForm" class="acct-form"><input type="hidden" name="reference" value="'+escapeHtml(o.reference||'')+'"><label class="acct-field"><span>Reason</span><textarea name="reason" required></textarea></label><button type="submit" class="add">SEND CANCELLATION REQUEST</button></form></details>':'')
    + (o.status==='delivered'?'<details class="acct-detail-block acct-fold"><summary>Return an item</summary><p class="acct-note inline-links">You can return items within 14 days of delivery. <a href="returns.html">Returns policy</a></p><form id="returnForm" class="acct-form"><input type="hidden" name="reference" value="'+escapeHtml(o.reference||'')+'"><label class="acct-field"><span>Item</span><select name="orderItemId">'+(o.items||[]).map(i=>'<option value="'+i.id+'">'+escapeHtml(i.productName)+' (max '+i.quantity+')</option>').join('')+'</select></label><label class="acct-field"><span>Quantity</span><input type="number" name="quantity" min="1" value="1"></label><label class="acct-field"><span>Reason</span><input name="reason" required></label><button type="submit" class="add">SEND RETURN REQUEST</button></form></details><details class="acct-detail-block acct-fold"><summary>Replace an item</summary><form id="replacementForm" class="acct-form"><input type="hidden" name="reference" value="'+escapeHtml(o.reference||'')+'"><label class="acct-field"><span>Item</span><select name="orderItemId">'+(o.items||[]).map(i=>'<option value="'+i.id+'">'+escapeHtml(i.productName)+' (max '+i.quantity+')</option>').join('')+'</select></label><label class="acct-field"><span>Quantity</span><input type="number" name="quantity" min="1" value="1"></label><label class="acct-field"><span>Reason</span><input name="reason" required></label><button type="submit" class="add">SEND REPLACEMENT REQUEST</button></form></details>':'')
    +'<div class="acct-detail-actions"><a class="button button--secondary" href="track.html?ref='+encodeURIComponent(o.reference||'')+'">TRACK ORDER</a><a class="button button--secondary" href="contact.html">CONTACT US</a></div>'
    +'</section>';
}
function accountPaymentsHtml(st){
  const list=st.payments||[];
  return '<section class="acct-panel"><div class="acct-section-head"><div><div class="eyebrow">PAYMENTS</div><h2>Payment history</h2></div></div>'
    +(list.length?list.map(p=>'<div class="acct-detail-row"><span>'+escapeHtml(p.createdAt?accountDate(p.createdAt):'')+' · '+escapeHtml(p.providerPaymentId||'')+'</span><strong>'+escapeHtml(p.status||'')+' · '+moneyMinor(p.amountMinor)+'</strong></div>').join(''):accountEmpty('No payments yet','Your payment attempts will appear here.',''))
    +'</section>';
}
function accountPanelHtml(st){
  if(st.tab==='orders')return accountOrdersHtml(st);
  if(st.tab==='order')return accountOrderDetailHtml(st);
  if(st.tab==='track')return accountTrackHtml(st);
  if(st.tab==='addresses')return accountAddressesHtml(st);
  if(st.tab==='details')return accountDetailsHtml(st);
  if(st.tab==='payments')return accountPaymentsHtml(st);
  return accountOverviewHtml(st);
}
function accountShellHtml(st){
  const p=st.profile||{};
  const firstName=String(p.name||p.email||'Client').trim().split(/\s+/)[0];
  const active=st.orders.filter(o=>accountGroup(o.status)==='active').length;
  return '<div class="acct-portal">'
    +'<header class="acct-head"><div class="acct-head-main"><div class="eyebrow">WELCOME BACK</div><h1 class="display">'+escapeHtml(accountGreeting())+', '+escapeHtml(firstName)+'.</h1><p class="acct-email">'+escapeHtml(p.email||'')+'</p></div>'
    +'<div class="acct-head-side">'+(p.role==='admin'?'<a class="button button--primary acct-admin-link" href="/admin">Open admin dashboard</a>':'')+'<span class="acct-head-count">'+active+' active order'+(active===1?'':'s')+'</span><button type="button" class="acct-refresh" data-account-refresh'+(st.loading?' disabled':'')+'>'+(st.loading?'Refreshing…':'Refresh')+'</button></div></header>'
    +accountTabsHtml(st)
    +'<div class="acct-body" role="tabpanel" aria-label="'+escapeHtml((ACCOUNT_TABS.find(t=>t.id===st.tab)||{}).label||'Overview')+'">'
    +(st.error?'<p class="acct-form-error" role="alert">'+escapeHtml(st.error)+'</p>':'')
    +accountPanelHtml(st)
    +'</div>'
    +'<div class="acct-footer" id="accountActions"></div>'
    +'</div>';
}
function ensureAccountState(profile){
  const id=profile&&profile.id;
  let st=window.__zaeviAccountState;
  if(!st||st.profileId!==id){
    st={profileId:id,profile:profile||{},orders:[],addresses:[],payments:[],tab:'overview',filter:'all',detail:null,detailRef:null,detailLoading:false,detailError:'',addressForm:null,addressError:'',notice:'',error:'',loading:false,loaded:false};
    window.__zaeviAccountState=st;
  }else{
    st.profile=profile||st.profile;
  }
  return st;
}
function paintAccount(authSection){
  if(!authSection||!window.__zaeviAccountState)return;
  authSection.innerHTML=accountShellHtml(window.__zaeviAccountState);
  wireAccountEvents(authSection);
  renderLogoutButton(authSection);
}
function renderAccountPortal(authSection,profile){
  ensureAccountState(profile);
  paintAccount(authSection);
  const st=window.__zaeviAccountState;
  if(!st.loaded&&!st.loading)loadAccountData(profile);
  startAccountPolling();
}
async function loadAccountData(profile,options){
  options=options||{};
  const st=window.__zaeviAccountState;
  if(!st)return;
  st.loading=true;
  if(!options.silent)paintAccount(document.querySelector('.zveiauth'));
  try{
    const [ordersRes,addressesRes]=await Promise.all([
      fetch('/api/customer/orders',{credentials:'same-origin'}),
      fetch('/api/customer/addresses',{credentials:'same-origin'}).catch(()=>null),
    ]);
    if(!ordersRes||!ordersRes.ok)throw new Error('orders');
    const orderData=await ordersRes.json().catch(()=>({}));
    st.orders=Array.isArray(orderData.data)?orderData.data:[];
    if(addressesRes&&addressesRes.ok){
      const addressData=await addressesRes.json().catch(()=>({}));
      st.addresses=Array.isArray(addressData.data)?addressData.data:[];
    }else{
      st.addresses=[];
    }
    st.loaded=true;
    st.error='';
    if(st.detailRef&&st.tab==='order'){
      await loadOrderDetail(st.detailRef,{silent:true,noPaint:true});
    }
  }catch(e){
    st.error='We could not load your account details. Please refresh the page.';
  }finally{
    st.loading=false;
    paintAccount(document.querySelector('.zveiauth'));
  }
}
async function loadOrderDetail(reference,options){
  options=options||{};
  const st=window.__zaeviAccountState;
  if(!st||!reference)return;
  st.detailRef=reference;
  st.detailLoading=true;
  st.detailError='';
  if(!options.silent)paintAccount(document.querySelector('.zveiauth'));
  try{
    const res=await fetch('/api/customer/orders/'+encodeURIComponent(reference),{credentials:'same-origin'});
    if(!res.ok)throw new Error('not-found');
    const body=await res.json().catch(()=>({}));
    st.detail=body.data||null;
    if(!st.detail)throw new Error('not-found');
  }catch(e){
    st.detail=null;
    st.detailError='This order could not be loaded. It may no longer be available.';
  }finally{
    st.detailLoading=false;
    if(!options.noPaint)paintAccount(document.querySelector('.zveiauth'));
  }
}
function openAccountOrder(reference){
  const st=window.__zaeviAccountState;
  if(!st)return;
  st.tab='order';
  st.detailRef=reference;
  st.detail=null;
  st.detailError='';
  paintAccount(document.querySelector('.zveiauth'));
  loadOrderDetail(reference);
}
async function reloadAddresses(){
  const st=window.__zaeviAccountState;
  if(!st)return;
  try{
    const res=await fetch('/api/customer/addresses',{credentials:'same-origin'});
    if(!res.ok)throw new Error('addresses');
    const body=await res.json().catch(()=>({}));
    st.addresses=Array.isArray(body.data)?body.data:[];
    st.addressError='';
  }catch(e){
    st.addressError='We could not load your saved addresses. Please try again.';
  }
  paintAccount(document.querySelector('.zveiauth'));
}
function addressFormValues(address){
  return {
    label:(address&&address.label)||'',
    fullName:(address&&address.fullName)||'',
    phone:(address&&address.phone)||'',
    addressLine1:(address&&address.addressLine1)||'',
    addressLine2:(address&&address.addressLine2)||'',
    city:(address&&address.city)||'',
    state:(address&&address.state)||'',
    postalCode:(address&&address.postalCode)||'',
    country:(address&&address.country)||'IN',
    isDefault:!!(address&&address.isDefault),
  };
}
async function submitAddressForm(form){
  const st=window.__zaeviAccountState;
  if(!st||!st.addressForm)return;
  const data={};
  ['label','fullName','phone','addressLine1','addressLine2','city','state','postalCode','country'].forEach(name=>{
    const el=form.elements&&form.elements[name];
    data[name]=el?String(el.value||'').trim():'';
  });
  const defaultEl=form.elements&&form.elements.isDefault;
  data.isDefault=!!(defaultEl&&defaultEl.checked);
  const editing=st.addressForm.mode==='edit';
  const id=st.addressForm.id;
  st.addressError='';
  st.notice='';
  try{
    const res=await fetch(editing?'/api/customer/addresses/'+encodeURIComponent(id):'/api/customer/addresses',{
      method:editing?'PATCH':'POST',
      credentials:'same-origin',
      headers:{'Content-Type':'application/json','x-csrf-token':getCsrfToken()||''},
      body:JSON.stringify(data),
    });
    const body=await res.json().catch(()=>({}));
    if(!res.ok){
      st.addressError=(body&&body.error&&body.error.message)||'We could not save this address. Please check the fields and try again.';
      paintAccount(document.querySelector('.zveiauth'));
      return;
    }
    st.addressForm=null;
    st.notice=editing?'Address updated.':'Address saved.';
    await reloadAddresses();
  }catch(e){
    st.addressError='We could not save this address. Please check your connection and try again.';
    paintAccount(document.querySelector('.zveiauth'));
  }
}
function wireAccountEvents(authSection){
  if(!authSection||authSection.__zaeviAccountWired)return;
  authSection.__zaeviAccountWired=true;
  authSection.addEventListener('click',accountClick);
  authSection.addEventListener('submit',accountSubmit);
  authSection.addEventListener('keydown',accountKeydown);
}
function accountClick(event){
  const target=event&&event.target;
  if(!target||typeof target.closest!=='function')return;
  const tab=target.closest('[data-account-tab]');
  if(tab){
    event.preventDefault();
    const st=window.__zaeviAccountState;
    if(!st)return;
    st.tab=tab.getAttribute('data-account-tab')||'overview';
    st.detailError='';
    st.addressForm=null;
    st.addressError='';
    st.notice='';
    paintAccount(document.querySelector('.zveiauth'));
    return;
  }
  const filter=target.closest('[data-account-filter]');
  if(filter){
    event.preventDefault();
    const st=window.__zaeviAccountState;
    if(!st)return;
    st.filter=filter.getAttribute('data-account-filter')||'all';
    paintAccount(document.querySelector('.zveiauth'));
    return;
  }
  const open=target.closest('[data-order-open]');
  if(open){
    event.preventDefault();
    openAccountOrder(open.getAttribute('data-order-open'));
    return;
  }
  const refresh=target.closest('[data-account-refresh]');
  if(refresh){
    event.preventDefault();
    loadAccountData(window.__zaeviAccountState&&window.__zaeviAccountState.profile,{silent:true});
    return;
  }
  const cDirect=target.closest('[data-cancel-direct]');
  if(cDirect){event.preventDefault();handleCancelDirect(cDirect.getAttribute('data-cancel-direct'));return;}
  const add=target.closest('[data-address-add]');
  if(add){
    event.preventDefault();
    const st=window.__zaeviAccountState;
    if(!st)return;
    st.addressForm={mode:'add',id:null,values:addressFormValues(null)};
    st.addressError='';
    st.notice='';
    paintAccount(document.querySelector('.zveiauth'));
    return;
  }
  const edit=target.closest('[data-address-edit]');
  if(edit){
    event.preventDefault();
    const st=window.__zaeviAccountState;
    if(!st)return;
    const id=Number(edit.getAttribute('data-address-edit'));
    const address=st.addresses.find(a=>a.id===id);
    if(!address)return;
    st.addressForm={mode:'edit',id:id,values:addressFormValues(address)};
    st.addressError='';
    st.notice='';
    paintAccount(document.querySelector('.zveiauth'));
    return;
  }
  const cancel=target.closest('[data-address-cancel]');
  if(cancel){
    event.preventDefault();
    const st=window.__zaeviAccountState;
    if(!st)return;
    st.addressForm=null;
    st.addressError='';
    paintAccount(document.querySelector('.zveiauth'));
    return;
  }
  const del=target.closest('[data-address-delete]');
  if(del){
    event.preventDefault();
    const st=window.__zaeviAccountState;
    if(!st)return;
    const id=Number(del.getAttribute('data-address-delete'));
    if(!id)return;
    let confirmed=false;
    try{confirmed=window.confirm('Remove this saved address?');}catch(e){confirmed=false;}
    if(!confirmed)return;
    fetch('/api/customer/addresses/'+encodeURIComponent(id),{
      method:'DELETE',
      credentials:'same-origin',
      headers:{'x-csrf-token':getCsrfToken()||''},
    }).then(res=>res.json().catch(()=>({})).then(body=>({ok:res.ok,body}))).then(result=>{
      if(!result.ok){st.addressError=(result.body&&result.body.error&&result.body.error.message)||'We could not remove this address.';paintAccount(document.querySelector('.zveiauth'));return;}
      st.notice='Address removed.';
      reloadAddresses();
    }).catch(()=>{st.addressError='We could not remove this address. Please try again.';paintAccount(document.querySelector('.zveiauth'));});
    return;
  }
  const makeDefault=target.closest('[data-address-default]');
  if(makeDefault){
    event.preventDefault();
    const st=window.__zaeviAccountState;
    if(!st)return;
    const id=Number(makeDefault.getAttribute('data-address-default'));
    if(!id)return;
    fetch('/api/customer/addresses/'+encodeURIComponent(id)+'/default',{
      method:'POST',
      credentials:'same-origin',
      headers:{'x-csrf-token':getCsrfToken()||''},
    }).then(res=>res.json().catch(()=>({})).then(body=>({ok:res.ok,body}))).then(result=>{
      if(!result.ok){st.addressError=(result.body&&result.body.error&&result.body.error.message)||'We could not update the default address.';paintAccount(document.querySelector('.zveiauth'));return;}
      st.notice='Default address updated.';
      reloadAddresses();
    }).catch(()=>{st.addressError='We could not update the default address. Please try again.';paintAccount(document.querySelector('.zveiauth'));});
  }
}
function handleCancelDirect(ref){
  if(!ref)return;
  let ok=false; try{ok=window.confirm('Cancel this order?');}catch(e){ok=false;}
  if(!ok)return;
  fetch('/api/customer/orders/'+encodeURIComponent(ref)+'/cancel',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','x-csrf-token':getCsrfToken()||''},body:JSON.stringify({reason:'Customer requested cancellation'})})
    .then(r=>r.json().catch(()=>({})).then(b=>({ok:r.ok,b})))
    .then(r=>finishOrderRequest(ref,r,'Your order has been cancelled.','We could not cancel this order. Please try again.'))
    .catch(()=>finishOrderRequest(ref,{ok:false},'','We could not cancel this order. Please try again.'));
}
async function finishOrderRequest(ref,result,okMessage,failMessage){
  const st=window.__zaeviAccountState;
  if(!st)return;
  st.notice=result.ok?okMessage:'';
  st.addressError=result.ok?'':((result.b&&result.b.error&&result.b.error.message)||failMessage);
  await loadOrderDetail(ref);
  const message=document.querySelector('.acct-detail .acct-notice,.acct-detail .acct-form-error');
  if(message)message.scrollIntoView({block:'center'});
}
function submitCancelRequest(form){
  const ref=form.elements.reference&&form.elements.reference.value;
  const reason=form.elements.reason&&form.elements.reason.value;
  fetch('/api/customer/orders/'+encodeURIComponent(ref)+'/cancel',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','x-csrf-token':getCsrfToken()||''},body:JSON.stringify({reason:reason})})
    .then(r=>r.json().catch(()=>({})).then(b=>({ok:r.ok,b})))
    .then(r=>finishOrderRequest(ref,r,'Cancellation request sent. You can see its status on this page.','We could not send your request. Please try again.'))
    .catch(()=>finishOrderRequest(ref,{ok:false},'','We could not send your request. Please try again.'));
}
function submitReturn(form){
  const ref=form.elements.reference&&form.elements.reference.value;
  const orderItemId=Number(form.elements.orderItemId&&form.elements.orderItemId.value);
  const quantity=Number(form.elements.quantity&&form.elements.quantity.value);
  const reason=form.elements.reason&&form.elements.reason.value;
  fetch('/api/customer/orders/'+encodeURIComponent(ref)+'/return',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','x-csrf-token':getCsrfToken()||''},body:JSON.stringify({reason:reason,items:[{orderItemId:orderItemId,quantity:quantity}]})})
    .then(r=>r.json().catch(()=>({})).then(b=>({ok:r.ok,b})))
    .then(r=>finishOrderRequest(ref,r,'Return request submitted. You can see its status on this page.','We could not send your return request. Please try again.'))
    .catch(()=>finishOrderRequest(ref,{ok:false},'','We could not send your return request. Please try again.'));
}
function submitReplacement(form){
  const ref=form.elements.reference&&form.elements.reference.value;
  const orderItemId=Number(form.elements.orderItemId&&form.elements.orderItemId.value);
  const quantity=Number(form.elements.quantity&&form.elements.quantity.value);
  const reason=form.elements.reason&&form.elements.reason.value;
  fetch('/api/customer/orders/'+encodeURIComponent(ref)+'/replacement',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','x-csrf-token':getCsrfToken()||''},body:JSON.stringify({reason:reason,items:[{orderItemId:orderItemId,quantity:quantity}]})})
    .then(r=>r.json().catch(()=>({})).then(b=>({ok:r.ok,b})))
    .then(r=>finishOrderRequest(ref,r,'Replacement request submitted. You can see its status on this page.','We could not send your replacement request. Please try again.'))
    .catch(()=>finishOrderRequest(ref,{ok:false},'','We could not send your replacement request. Please try again.'));
}
function accountSubmit(event){
  const form=event&&event.target;
  if(!form)return;
  const handlers={addressForm:submitAddressForm,cancelRequestForm:submitCancelRequest,returnForm:submitReturn,replacementForm:submitReplacement};
  const handler=handlers[form.id];
  if(!handler)return;
  event.preventDefault();
  handler(form);
}
function accountKeydown(event){
  if(!event||(event.key!=='Enter'&&event.key!==' '))return;
  const target=event.target;
  if(!target||typeof target.closest!=='function')return;
  const card=target.closest('.acct-order-card[data-order-open]');
  if(!card)return;
  event.preventDefault();
  openAccountOrder(card.getAttribute('data-order-open'));
}
function startAccountPolling(){
  if(typeof setInterval!=='function'||accountPollTimer)return;
  accountPollTimer=setInterval(()=>{
    if(typeof document.visibilityState==='string'&&document.visibilityState!=='visible')return;
    const st=window.__zaeviAccountState;
    if(!st||!st.profile)return;
    loadAccountData(st.profile,{silent:true});
  },60000);
}
function stopAccountPolling(){
  if(accountPollTimer&&typeof clearInterval==='function')clearInterval(accountPollTimer);
  accountPollTimer=null;
}
if(typeof document.addEventListener==='function'){
  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState!=='visible')return;
    const st=window.__zaeviAccountState;
    if(!st||!st.profile)return;
    loadAccountData(st.profile,{silent:true});
  });
}

// Shows a Dashboard link in the site navigation for administrators only. This is
// only a shortcut: /admin itself is protected on the server for every request.
function syncAdminLinks(profile){
  if(typeof document.querySelectorAll!=='function'||typeof document.querySelector!=='function')return;
  const isAdmin=Boolean(profile&&profile.role==='admin');
  document.querySelectorAll('[data-admin-link]').forEach(el=>el.remove());
  if(!isAdmin)return;
  document.querySelector('.nav .links.right')?.insertAdjacentHTML?.('afterbegin','<a href="/admin" data-admin-link>Dashboard</a>');
  document.querySelector('.mobile-links')?.insertAdjacentHTML?.('afterbegin','<a href="/admin" data-admin-link>Dashboard</a>');
}
function renderAuthUI(){
  checkAuth().then(({authenticated,data})=>{
    // Release the shared signal first so the cart Checkout entry point and the
    // checkout page gate can reuse this authoritative check instead of issuing
    // a second GET /api/auth/me per page load.
    markAuthSettled({authenticated,data});
    window.__zaeviAuth={authenticated,profile:data&&data.data?data.data:null};
    syncAdminLinks(window.__zaeviAuth.profile);
    const authSection=document.querySelector('.zveiauth');
    if(!authSection)return;
    if(authenticated&&data.data){
      // Premium customer portal. The existing session/order APIs stay
      // authoritative; this renderer only shapes their data.
      renderAccountPortal(authSection,data.data);
    }else{
      authSection.innerHTML='<div class="auth-card">'+
        '<div class="eyebrow">ZAEVI CLIENT SERVICES</div>'+
        '<h1 class="display">Your account.</h1>'+
        '<p>Sign in to review your orders, saved addresses and wishlist.</p>'+
        '<div class="auth-tabs" style="display:flex;gap:18px;margin:22px 0 14px;border-bottom:1px solid var(--line);padding-bottom:10px;">'+
        '<button type="button" id="tabSignIn" style="background:none;border:none;cursor:pointer;font-family:inherit;font-size:11px;letter-spacing:.1em;font-weight:600;padding:4px 0;border-bottom:2px solid var(--ink);color:var(--ink);text-transform:uppercase;" onclick="switchAuthTab(\'login\')">SIGN IN</button>'+
        '<button type="button" id="tabRegister" style="background:none;border:none;cursor:pointer;font-family:inherit;font-size:11px;letter-spacing:.1em;font-weight:500;padding:4px 0;border-bottom:2px solid transparent;color:var(--muted);text-transform:uppercase;" onclick="switchAuthTab(\'register\')">CREATE ACCOUNT</button>'+
        '</div>'+
        '<div class="auth-form" id="loginForm">'+
        '<label class="sr-only" for="loginEmail">Email address</label>'+
        '<input class="forminput" id="loginEmail" placeholder="Email address" autocomplete="email" onkeydown="if(event.key===\'Enter\')loginUser()"/>'+
        '<label class="sr-only" for="loginPassword">Password</label>'+
        '<input class="forminput" id="loginPassword" placeholder="Password" type="password" autocomplete="current-password" onkeydown="if(event.key===\'Enter\')loginUser()"/>'+
        '<button class="add" type="button" onclick="loginUser()">SIGN IN</button>'+
        '<p class="auth-error" id="loginError" role="alert"></p>'+
        '<p class="auth-status" id="logoutMessage" role="status"></p>'+
        '<p class="auth-alt" id="forgotPasswordLine"><a href="reset-password.html">Forgot your password?</a></p>'+
        '</div>'+
        '<p class="auth-alt" id="loginAltNotice">New to ZAEVI? <a href="#" onclick="switchAuthTab(\'register\');return false">Create an account</a></p>'+
        '<div class="auth-register" id="registerForm" hidden style="border-top:none;margin-top:0;padding-top:0">'+
        '<label class="sr-only" for="regName">Full name</label>'+
        '<input class="forminput" id="regName" placeholder="Full name" autocomplete="name"/>'+
        '<label class="sr-only" for="regEmail">Email address</label>'+
        '<input class="forminput" id="regEmail" placeholder="Email address" autocomplete="email"/>'+
        '<label class="sr-only" for="regPhone">Phone</label>'+
        '<input class="forminput" id="regPhone" placeholder="Phone" autocomplete="tel"/>'+
        '<label class="sr-only" for="regPassword">Password</label>'+
        '<input class="forminput" id="regPassword" placeholder="Password (min. 12 characters)" type="password" autocomplete="new-password" onkeydown="if(event.key===\'Enter\')registerUser()"/>'+
        '<span style="font-size:11px;color:var(--muted);display:block;margin-top:4px;margin-bottom:8px">Password must be at least 12 characters.</span>'+
        '<button class="add" type="button" onclick="registerUser()">CREATE ACCOUNT</button>'+
        '<p class="auth-alt"><a href="#" onclick="switchAuthTab(\'login\');return false">Sign in instead</a></p>'+
        '<p class="auth-alt inline-links">Read our <a href="terms.html">Terms</a> and <a href="privacy.html">Privacy Policy</a>.</p>'+
        '</div></div>';
      // One-shot notice from a successful logout, rendered into the freshly
      // built sign-in view and then cleared so it never persists across loads.
      const logoutNotice=window.__zaeviLogoutNotice||'';
      window.__zaeviLogoutNotice='';
      if(logoutNotice){const el=document.getElementById('logoutMessage');if(el)el.textContent=logoutNotice;}
    }
  }).catch(()=>{
    // The check rejected outright — fail closed and still release the shared
    // signal so the cart Checkout button can surface a recoverable message
    // instead of hanging on an unresolved promise.
    window.__zaeviAuth={authenticated:false,profile:null};
    markAuthSettled({authenticated:false});
  });
}
function switchAuthTab(tab){
  const loginForm=document.getElementById('loginForm');
  const regForm=document.getElementById('registerForm');
  const tabSign=document.getElementById('tabSignIn');
  const tabReg=document.getElementById('tabRegister');
  const loginAlt=document.getElementById('loginAltNotice');
  const errEl=document.getElementById('loginError');
  if(errEl)errEl.textContent='';
  if(tab==='register'){
    if(loginForm)loginForm.hidden=true;
    if(loginAlt)loginAlt.hidden=true;
    if(regForm)regForm.hidden=false;
    if(tabSign){tabSign.style.borderBottom='2px solid transparent';tabSign.style.color='var(--muted)';tabSign.style.fontWeight='500';}
    if(tabReg){tabReg.style.borderBottom='2px solid var(--ink)';tabReg.style.color='var(--ink)';tabReg.style.fontWeight='600';}
  }else{
    if(loginForm)loginForm.hidden=false;
    if(loginAlt)loginAlt.hidden=false;
    if(regForm)regForm.hidden=true;
    if(tabSign){tabSign.style.borderBottom='2px solid var(--ink)';tabSign.style.color='var(--ink)';tabSign.style.fontWeight='600';}
    if(tabReg){tabReg.style.borderBottom='2px solid transparent';tabReg.style.color='var(--muted)';tabReg.style.fontWeight='500';}
  }
}
window.switchAuthTab=switchAuthTab;
function registerUser(){
  const name=document.getElementById('regName')?.value||'';
  const email=document.getElementById('regEmail')?.value||'';
  const phone=document.getElementById('regPhone')?.value||'';
  const password=document.getElementById('regPassword')?.value||'';
  const errEl=document.getElementById('loginError');
  if(errEl)errEl.textContent='';
  const showMessage=(msg)=>{
    const el=document.getElementById('loginError');
    if(el)el.textContent=msg||'';
  };
  register(name,email,phone,password).then((result)=>{
    if(result&&result.status===201){
      const created=result.data&&result.data.data;
      if(created&&created.otpRequired){showOtpStep(created);return;}
      // POST /api/auth/register creates the account but does not start a
      // session, so sign the customer in immediately with the same credentials
      // (reusing the existing login() flow). Without this the customer lands
      // back on the sign-in form: the authenticated view — welcome header and
      // the LOGOUT button — never renders.
      login(email,password).then((loginResult)=>{
        if(loginResult&&loginResult.status===200){
          if(afterAuthRedirect())return;
          renderAuthUI();
          return;
        }
        showMessage(authErrorMessage(loginResult,'We could not sign you in after registration. Please sign in manually.'));
      });
      return;
    }
    showMessage(authErrorMessage(result,'We could not create your account. Please try again.'));
  });
}
document.addEventListener?.('DOMContentLoaded',()=>{
  const csrf=document.cookie.split(';').find(c=>c.startsWith('zaevi.csrf='));
  if(csrf)window.__zaeviCsrfToken=csrf.split('=')[1];
  renderAuthUI();
});
// ============================================================
// Intro / Loading animation completion
// ============================================================
(function(){
  const loader = $('.loader');
  if(!loader)return; // only on index page
  const reveals = $$('.reveal');
  if(!reveals.length)return;

  // Safe fallback: after 2s, reliably hide loader and show content
  const fallback=setTimeout(()=>{
    loader.classList.add('off');
    reveals.forEach(r=>r.classList.add('in'));
  },2000);

  // Try animationend detection as early exit
  let completed=false;
  const onAnimEnd=()=>{
    if(completed)return;
    completed=true;
    clearTimeout(fallback);
    loader.classList.add('off');
    reveals.forEach(r=>r.classList.add('in'));
  };
  loader.addEventListener('animationend',(e)=>{
    // 'loader-in' animates the logo fade-in, 'loader-line' animates the loadline width
    if(e.animationName==='loader-in'||e.animationName==='loader-line')onAnimEnd();
  });
  // Also listen on reveal elements in case their transition fires first
  reveals.forEach(r=>r.addEventListener('animationend',onAnimEnd));
})();

// Render the Logout control into the authenticated account section.
// Reuses the existing confirmLogout()/logout() implementations and uses DOM
// APIs only (no text matching, no raw HTML injection, no arbitrary timeouts).
// The button is always a FRESH node (old one removed first), so every render
// pass binds the click listener at most once — no duplicate listeners or
// duplicate requests are possible. A dedicated status line (role=alert) sits
// under the button for logout errors; it is wiped by any section re-render.
function renderLogoutButton(authSection){
  if(!authSection)return;
  const existing=authSection.querySelector(".logout-btn");
  if(existing)existing.remove();
  const stale=document.getElementById("logoutStatus");
  if(stale&&stale.parentNode)stale.parentNode.removeChild(stale);
  const btn=document.createElement("button");
  btn.type="button";
  btn.className="add logout-btn";
  btn.textContent="LOGOUT";
  btn.style.marginTop="12px";
  // The confirmation gate lives in confirmLogout so logout() itself stays a
  // plain (programmatically callable) sign-out routine.
  btn.addEventListener("click",confirmLogout);
  const actions=authSection.querySelector("#accountActions");
  if(actions){
    actions.appendChild(btn);
    const actionStatus=document.createElement("p");
    actionStatus.id="logoutStatus";
    actionStatus.setAttribute("role","alert");
    actionStatus.style.cssText="font-size:11px;margin-top:8px;min-height:14px";
    actions.appendChild(actionStatus);
    return;
  }
  const history=authSection.querySelector(".order-history");
  if(history)authSection.insertBefore(btn,history);
  else authSection.appendChild(btn);
  const status=document.createElement("p");
  status.id="logoutStatus";
  status.setAttribute("role","alert");
  status.style.cssText="font-size:11px;margin-top:8px;min-height:14px";
  if(history)authSection.insertBefore(status,history);
  else authSection.appendChild(status);
}

// Sign-in UI wiring. Reuses the existing login() implementation (no second
// login logic) and renders the authenticated view on success; surfaces the
// server's error message on failure without breaking the page.
// Unified portal: administrators are routed to the admin console,
// customers stay on the account page. A validated `next` path still wins.
function finishLogin(profile){
  const next=nextAfterLogin();
  if(!next && profile && profile.role==='admin'){
    try{location.href='/admin'}catch(e){}
    return;
  }
  if(afterAuthRedirect())return;
  renderAuthUI();
}
// Second step of signing up or signing in: the code sent by email.
function otpResendCountdown(seconds){
  const button=document.getElementById('otpResend');
  if(!button)return;
  clearInterval(window.__zaeviOtpTimer);
  let left=seconds;
  const paint=()=>{
    button.disabled=left>0;
    button.textContent=left>0?'Send a new code in '+left+'s':'Send a new code';
  };
  paint();
  window.__zaeviOtpTimer=setInterval(()=>{
    left-=1;
    paint();
    if(left<=0)clearInterval(window.__zaeviOtpTimer);
  },1000);
}
function showOtpStep(otp){
  const card=document.querySelector('.auth-card');
  if(!card)return;
  window.__zaeviOtp=otp;
  ['loginPassword','regPassword'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  ['loginForm','registerForm','loginAltNotice'].forEach(id=>{const el=document.getElementById(id);if(el)el.hidden=true;});
  const tabs=card.querySelector('.auth-tabs');
  if(tabs)tabs.style.display='none';
  let box=document.getElementById('otpForm');
  if(!box){
    box=document.createElement('div');
    box.className='auth-form auth-otp';
    box.id='otpForm';
    card.appendChild(box);
  }
  box.hidden=false;
  box.innerHTML='<p class="auth-otp-intro">We sent a 6-digit code to <strong>'+escapeHtml(otp.email||'your email')+'</strong>. It expires in 10 minutes.'+(otp.viaServerLog?' Development only: the code is in the server log.':'')+'</p>'+
    '<label class="label" for="otpCode">6-DIGIT CODE</label>'+
    '<input class="forminput auth-otp-code" id="otpCode" inputmode="numeric" pattern="[0-9]*" autocomplete="one-time-code" maxlength="6" onkeydown="if(event.key===\'Enter\')verifyOtp()"/>'+
    '<button class="add" type="button" id="otpVerify" onclick="verifyOtp()">CONFIRM</button>'+
    '<p class="auth-error" id="otpError" role="alert"></p>'+
    '<p class="auth-otp-actions"><button type="button" class="auth-otp-link" id="otpResend" onclick="resendOtp()"></button><button type="button" class="auth-otp-link" onclick="cancelOtp()">Start again</button></p>';
  otpResendCountdown(otp.resendInSeconds||60);
  document.getElementById('otpCode')?.focus?.();
}
async function otpRequest(path,body){
  const res=await fetch(path,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const json=await res.json().catch(()=>({}));
  return{ok:res.ok,json,message:(json.error&&json.error.message)||''};
}
async function verifyOtp(){
  const otp=window.__zaeviOtp;
  const input=document.getElementById('otpCode');
  const error=document.getElementById('otpError');
  const button=document.getElementById('otpVerify');
  if(!otp||!input)return;
  const code=input.value.trim();
  if(!/^[0-9]{6}$/.test(code)){if(error)error.textContent='Please enter the 6-digit code.';return;}
  if(button)button.disabled=true;
  if(error)error.textContent='';
  try{
    const result=await otpRequest('/api/auth/otp/verify',{challenge:otp.challenge,code});
    if(!result.ok){
      if(error)error.textContent=result.message||'We could not check that code. Please try again.';
      return;
    }
    const csrf=document.cookie.split(';').map(c=>c.trim()).find(c=>c.startsWith('zaevi.csrf='));
    if(csrf)window.__zaeviCsrfToken=csrf.split('=')[1];
    clearInterval(window.__zaeviOtpTimer);
    window.__zaeviOtp=null;
    finishLogin(result.json.data);
  }catch(e){
    if(error)error.textContent='We could not reach the server. Please check your connection and try again.';
  }finally{
    if(button)button.disabled=false;
  }
}
async function resendOtp(){
  const otp=window.__zaeviOtp;
  const error=document.getElementById('otpError');
  if(!otp)return;
  if(error)error.textContent='';
  try{
    const result=await otpRequest('/api/auth/otp/resend',{challenge:otp.challenge});
    if(!result.ok){
      if(error)error.textContent=result.message||'We could not send a new code. Please try again.';
      return;
    }
    if(error)error.textContent='A new code is on its way.';
    otpResendCountdown(result.json.data&&result.json.data.resendInSeconds||60);
  }catch(e){
    if(error)error.textContent='We could not reach the server. Please check your connection and try again.';
  }
}
function cancelOtp(){
  clearInterval(window.__zaeviOtpTimer);
  window.__zaeviOtp=null;
  renderAuthUI();
}
function loginUser(){
  const email=document.getElementById("loginEmail")?.value||"";
  const password=document.getElementById("loginPassword")?.value||"";
  const errEl=document.getElementById("loginError");
  if(errEl)errEl.textContent="";
  if(!email.trim()){
    if(errEl)errEl.textContent="Please enter your email address";
    return;
  }
  if(!password){
    if(errEl)errEl.textContent="Please enter your password";
    return;
  }
  login(email.trim(),password).then((result)=>{
    if(result&&result.status===200){
      const profile=result.data&&result.data.data;
      if(profile&&profile.otpRequired){showOtpStep(profile);return;}
      finishLogin(profile);
      return;
    }
    if(!result)return;
    const data=result.data;
    const msg=(data&&data.error&&data.error.message)||(result.error&&result.error.message)||"Invalid email or password";
    const el=document.getElementById("loginError");
    if(el){
      if(result.status===401){
        el.textContent="Invalid email or password. New to ZAEVI? Click 'CREATE ACCOUNT' above.";
      }else{
        el.textContent=msg;
      }
    }
  });
}

// Normalise an error result into a displayable message (both {error:{message}}
// and string-error shapes are handled). Used by sign-in/sign-up flows so the
// server's messages surface consistently in the existing #loginError slot.
function authErrorMessage(result,fallback){
  if(result&&result.error&&typeof result.error.message==='string'&&result.error.message)return result.error.message;
  if(result&&typeof result.error==='string'&&result.error)return result.error;
  return fallback;
}

// Bound at load (not inside the async init) so the account-first Checkout
// entry point is live as soon as the drawer markup is parsed.
wireCheckoutButtons();

init();


// ============================================================
// Marketing & Reviews Helpers
// ============================================================
function setupAnnouncementBar(){
  fetch('/api/cms/settings/public').catch(()=>fetch('/api/cms/settings')).then(r=>r&&r.ok?r.json():null).then(res=>{
    const s=res&&res.data;
    if(s&&s.announcementEnabled&&s.announcementText){
      if(document.getElementById('announcement-bar'))return;
      const bar=document.createElement('div');
      bar.id='announcement-bar';
      bar.className='announcement-bar';
      bar.style.cssText='background:var(--rouge-deep);color:#fff;text-align:center;padding:8px 16px;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;z-index:999;position:relative;';
      if(s.announcementLink){
        bar.innerHTML='<a href="'+escapeHtml(s.announcementLink)+'" style="color:inherit;text-decoration:underline;">'+escapeHtml(s.announcementText)+'</a>';
      }else{
        bar.textContent=s.announcementText;
      }
      document.body.insertBefore(bar,document.body.firstChild);
    }
  }).catch(()=>{});
}

async function loadProductReviews(productId){
  const container=$('#reviewsContainer');
  if(!container)return;
  try{
    const res=await fetch('/api/products/'+encodeURIComponent(productId)+'/reviews');
    const json=await res.json().catch(()=>({}));
    if(!res.ok)return;
    const data=json.data||{};
    const reviews=data.reviews||[];
    const stats=data.stats||{total:0,averageRating:0};
    const countEl=$('#reviewCount');
    const avgEl=$('#reviewAvg');
    if(countEl)countEl.textContent=stats.total+' '+(stats.total===1?'review':'reviews');
    if(avgEl)avgEl.textContent=stats.total>0?'★ '+stats.averageRating+' / 5.0':'No reviews yet';
    if(!reviews.length){
      container.innerHTML='<p class="muted" style="color:var(--muted);font-size:13px;">No client reviews for this atelier piece yet. Be the first to share your experience.</p>';
      return;
    }
    container.innerHTML=reviews.map(r=>`
      <div class="review-card" style="border-bottom:1px solid var(--line);padding:16px 0;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
          <strong style="font-size:13px;">${escapeHtml(r.authorName)} ${r.verifiedPurchase?'<span style="font-size:9px;text-transform:uppercase;letter-spacing:1px;background:var(--paper-deep);padding:2px 6px;margin-left:6px;border-radius:2px;">Verified Patron</span>':''}</strong>
          <span style="color:var(--gold-dark);letter-spacing:2px;font-size:12px;">${'★'.repeat(r.rating)}${'☆'.repeat(5-r.rating)}</span>
        </div>
        ${r.title?`<div style="font-weight:600;font-size:13px;margin:4px 0 2px;">${escapeHtml(r.title)}</div>`:''}
        <p style="font-size:13px;line-height:1.6;margin:4px 0 8px;color:var(--ink-2);">${escapeHtml(r.content)}</p>
        <div style="font-size:11px;color:var(--muted);display:flex;justify-content:space-between;align-items:center;">
          <span>${r.createdAt?String(r.createdAt).slice(0,10):''}</span>
          <button type="button" class="helpful-btn" data-id="${r.id}" style="background:none;border:none;cursor:pointer;font-size:11px;color:var(--muted);padding:0;">Helpful (${r.helpfulCount||0})</button>
        </div>
      </div>
    `).join('');
    container.querySelectorAll('.helpful-btn').forEach(btn=>{
      btn.addEventListener('click',async()=>{
        const id=btn.getAttribute('data-id');
        const hRes=await fetch('/api/reviews/'+id+'/helpful',{method:'POST'});
        const hData=await hRes.json().catch(()=>({}));
        if(hRes.ok&&hData.data){
          btn.textContent='Helpful ('+hData.data.helpfulCount+')';
          btn.disabled=true;
        }
      });
    });
  }catch(e){}
}

function wireReviewForm(productId){
  const form=$('#reviewForm');
  if(!form)return;
  form.onsubmit=async e=>{
    e.preventDefault();
    const rating=form.querySelector('[name="rating"]')?.value;
    const title=form.querySelector('[name="title"]')?.value;
    const content=form.querySelector('[name="content"]')?.value;
    const msg=$('#reviewFormMsg');
    const btn=form.querySelector('button[type="submit"]');
    if(!rating){if(msg){msg.textContent='Please select a rating.';msg.style.color='var(--danger)';msg.hidden=false}return}
    if(btn)btn.disabled=true;
    try{
      const csrf=(function(){
        const parts=document.cookie.split(';');
        for(let i=0;i<parts.length;i++){
          const c=parts[i].trim();
          if(c.indexOf('zaevi.csrf=')===0)return decodeURIComponent(c.slice('zaevi.csrf='.length));
        }
        return '';
      })();
      const res=await fetch('/api/products/'+encodeURIComponent(productId)+'/reviews',{
        method:'POST',
        headers:{'Content-Type':'application/json',...(csrf?{'x-csrf-token':csrf}:{})},
        body:JSON.stringify({rating,title,content}),
      });
      const data=await res.json().catch(()=>({}));
      if(res.ok){
        if(msg){msg.textContent='Thank you. Your review has been submitted.';msg.style.color='var(--success)';msg.hidden=false}
        form.reset();
        loadProductReviews(productId);
      }else{
        if(msg){msg.textContent=(data.error&&data.error.message)||'Could not submit review. Please sign in to submit.';msg.style.color='var(--danger)';msg.hidden=false}
      }
    }catch(err){
      if(msg){msg.textContent='Network error. Please try again.';msg.style.color='var(--danger)';msg.hidden=false}
    }finally{
      if(btn)btn.disabled=false;
    }
  };
}
