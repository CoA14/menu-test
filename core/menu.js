/*! Digital menu. All rights reserved. See LICENSE. */
(async function(){"use strict";const{LANGS:w,TAGS:j,SOCIAL:M,translator:le,localized:re,plural:de,linkUrl:E,socialProfile:me,icon:pe,scheduleLines:he,savedLang:ue,saveLang:fe,esc:s,formatPrice:T,getJSON:b}=window.DM,m=document.getElementById("app"),p=document.documentElement,C="dm-lang",U=document.currentScript&&new URL(document.currentScript.src).search||"",ge={sr:{title:"Meni",loadError:"Na\u017Ealost, meni trenutno ne mo\u017Ee da se u\u010Dita. Poku\u0161ajte ponovo za trenutak.",empty:"Meni je u pripremi.<br>Navratite uskoro!",sections:"Kategorije menija",details:"Detalji",close:"Zatvori",hours:"Radno vreme",address:"Adresa",phone:"Telefon",wifi:"Wi-Fi",password:"Lozinka:",followUs:"Pratite nas",links:"Linkovi",madeBy:"Digitalni meni: {name}",switchLang:"Prebaci na engleski",back:"Nazad",recommended:"Preporu\u010Dujemo"},en:{title:"Menu",loadError:"Sorry, the menu could not be loaded. Please try again in a moment.",empty:"Our menu is being prepared.<br>Please check back soon!",sections:"Menu sections",details:"Item details",close:"Close",hours:"Opening hours",address:"Address",phone:"Phone",wifi:"Wi-Fi",password:"Password:",followUs:"Follow us",links:"Links",madeBy:"Digital menu by {name}",switchLang:"Switch to Serbian",back:"Back",recommended:"Recommended"}},A=new URLSearchParams(location.search).get("lang");let d=w.includes(A)?A:ue(C)||"sr";const o=le(ge,()=>d),c=(e,t)=>re(e,t,d);function N(e){return new Promise(t=>{const a=document.createElement("link");a.rel="stylesheet",a.href=e,a.onload=a.onerror=t,document.head.appendChild(a)})}const O=(new URLSearchParams(location.search).get("demo")||"").replace(/[^a-z-]/g,""),x=O?`demo/${O}/`:"content/";let i,B,v,y,H;try{[i,B,H]=await Promise.all([b(`${x}settings.json`),b(`${x}menu.json`),b(`core/brand.json${U}`).catch(()=>({}))]);const e=new URLSearchParams(location.search).get("theme");y=String(e||i.theme||"classic").replace(/[^a-z0-9-]/gi,""),v=await b(`themes/${y}/theme.json`).catch(()=>({})),await N(`themes/${y}/theme.css${U}`)}catch(e){m.innerHTML=`<p class="dm-error">${o("loadError")}</p>`,document.body.classList.remove("dm-loading"),console.error(e);return}const D=i.english!==!1;D||(d="sr"),p.dataset.theme=y;const $e=new URLSearchParams(location.search).get("logo")==="sample",we=["list","cards","text"];p.dataset.layout=[new URLSearchParams(location.search).get("items"),i.itemStyle,v.layout].find(e=>we.includes(e))||"list";const be=["scroll","tabs","bottom","tiles","accordion"],h=[new URLSearchParams(location.search).get("layout"),i.layout,v.nav].find(e=>be.includes(e))||"scroll";p.dataset.nav=h;const F=new URLSearchParams(location.search),$=(v.palettes||[]).find(e=>e.id===(F.get("palette")||i.palette));$&&(Object.entries($.vars||{}).forEach(([e,t])=>p.style.setProperty(e,t)),$.scheme&&(p.style.colorScheme=$.scheme)),i.accent&&p.style.setProperty("--accent",i.accent);const Y=$&&$.themeColor||v.themeColor;Y&&(document.querySelector('meta[name="theme-color"]').content=Y);const _=F.get("font")||i.font;if(_){const t=(await b(`core/fonts.json${U}`).catch(()=>[])).find(a=>a.id===_);t&&(await N(t.css),p.style.setProperty("--font-head",t.head),p.style.setProperty("--font-body",t.body),p.style.setProperty("--font-display",t.head),p.style.setProperty("font-synthesis-weight","none"))}const u=(B.categories||[]).map(e=>({...e,items:(e.items||[]).filter(t=>t.available!==!1)})).filter(e=>e.items.length),G=new Map;u.forEach(e=>e.items.forEach(t=>G.set(t.id,t)));const I=h==="tabs"||h==="bottom",V=i.featured?u.flatMap(e=>e.items).filter(e=>(e.tags||[]).some(t=>t==="popular"||t==="new")).slice(0,8):[],ve=e=>e.image||(e.items.find(t=>t.image)||{}).image||"",W=e=>`${e} ${de(e,d,{sr:["stavka","stavke","stavki"],en:["item","items"]})}`;function K(e){const t=(e||[]).filter(a=>j[a]);return t.length?`<ul class="tags">${t.map(a=>`<li class="tag tag-${a}"><span class="tag-icon" aria-hidden="true">${j[a].icon}</span>${j[a][d]}</li>`).join("")}</ul>`:""}function J(e){const t=T(e.price,i),a=c(e,"description");return`
      <article class="item${e.image?" has-img":""}" data-id="${s(e.id)}" tabindex="0" role="button" aria-label="${s(c(e,"name"))}">
        ${e.image?`<img class="item-img" src="${s(e.image)}" alt="" loading="lazy">`:""}
        <div class="item-body">
          <div class="item-head">
            <h3 class="item-name">${s(c(e,"name"))}</h3>
            <span class="leader" aria-hidden="true"></span>
            ${t?`<span class="item-price">${s(t)}</span>`:""}
          </div>
          ${a?`<p class="item-desc">${s(a)}</p>`:""}
          <div class="item-meta">
            ${e.size?`<span class="item-size">${s(Q(e.size))}</span>`:""}
            ${K(e.tags)}
          </div>
        </div>
      </article>`}function ye(){const e=i,t=c(e,"note"),a=[],r=he(e.schedule,d);if(r.length?a.push([o("hours"),`<span class="hours">${r.map(n=>`<span>${s(n.days)}</span><span>${s(n.times)}</span>`).join("")}</span>`]):c(e,"hours")&&a.push([o("hours"),s(c(e,"hours")).replace(/\n/g,"<br>")]),e.address){const n=e.location?`${e.location.lat},${e.location.lng}`:e.address;a.push([o("address"),`<a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(n)}" target="_blank" rel="noopener">${s(e.address)}</a>`])}e.phone&&a.push([o("phone"),`<a href="tel:${s(e.phone.replace(/[^\d+]/g,""))}">${s(e.phone)}</a>`]),e.wifiName&&a.push([o("wifi"),`${s(e.wifiName)}${e.wifiPassword?`<br><span class="muted">${o("password")}</span> ${s(e.wifiPassword)}`:""}`]);const l=n=>`<span class="info-links">${n.map(([f,Ie,Re])=>`<a href="${s(Re)}" target="_blank" rel="noopener">${pe(f)}<span>${s(Ie)}</span></a>`).join("")}</span>`,g=Object.keys(M).map(n=>[n,me(e[n],n)]).filter(([,n])=>n).map(([n,f])=>[n,f.handle?`@${f.handle}`:M[n].label,f.url]);g.length&&a.push([o("followUs"),l(g)]);const R=E(e.website),ie=[...R?[["website",new URL(R).hostname.replace(/^www\./,""),R]]:[],...(e.links||[]).map(n=>["link",n.label||n.url,E(n.url)]).filter(([,n,f])=>n&&f)];ie.length&&a.push([o("links"),l(ie)]);const ce=E(H.url),q=s(H.name||""),z=q?o("madeBy",{name:ce?`<a href="${s(ce)}" target="_blank" rel="noopener">${q}</a>`:q}):"";return!a.length&&!t&&!z?"":`
      <footer class="info">
        <div class="wrap">
          ${a.length?`<dl class="info-grid">${a.map(([n,f])=>`<div><dt>${n}</dt><dd>${f}</dd></div>`).join("")}</dl>`:""}
          ${t?`<p class="info-note">${s(t)}</p>`:""}
          ${z?`<p class="info-credit">${z}</p>`:""}
        </div>
      </footer>`}function Z(){return D?`
      <button type="button" class="lang-switch" data-lang="${w[(w.indexOf(d)+1)%w.length]}" aria-label="${o("switchLang")}">
        ${w.map(t=>`<span class="lang-btn${t===d?" active":""}" lang="${t}">${t.toUpperCase()}</span>`).join("")}
      </button>`:""}const Q=e=>d==="en"?e.replace(/\bkom\b/,"pcs"):e;function Le(){const e=c(i,"tagline"),t=$e?`demo/images/logo-${d}.svg`:i.logo;return`
      <header class="hero">
        ${Z()}
        <div class="wrap">
          ${t?`<img class="hero-logo" src="${s(t)}" alt="">`:""}
          <h1 class="hero-name">${s(i.name||o("title"))}</h1>
          ${e?`<p class="hero-tagline">${s(e)}</p>`:""}
        </div>
      </header>`}function Se(){return V.length?`
      <section class="featured" aria-label="${o("recommended")}">
        <div class="wrap"><h2 class="featured-title">${o("recommended")}</h2></div>
        <div class="featured-row">
          ${V.map(e=>`
            <button type="button" class="feat" data-id="${s(e.id)}">
              ${e.image?`<img class="feat-img" src="${s(e.image)}" alt="" loading="lazy">`:'<span class="feat-img"></span>'}
              <span class="feat-name">${s(c(e,"name"))}</span>
              <span class="feat-price">${s(T(e.price,i))}</span>
            </button>`).join("")}
        </div>
      </section>`:""}function X(e,t){return`
      <section class="cat${t?" active":""}" id="cat-${s(e.id)}" data-cat="${s(e.id)}">
        <div class="wrap">
          <header class="cat-head">
            <h2 class="cat-name">${s(c(e,"name"))}</h2>
            ${c(e,"description")?`<p class="cat-desc">${s(c(e,"description"))}</p>`:""}
          </header>
          <div class="items">${e.items.map(J).join("")}</div>
        </div>
      </section>`}function ke(e){const t=I?"button":"a";return`
      <nav class="catnav" aria-label="${o("sections")}">
        <div class="catnav-inner">
          ${u.map(a=>`<${t} class="chip${a.id===e?" active":""}" data-cat="${s(a.id)}"${t==="a"?` href="#cat-${s(a.id)}"`:' type="button"'}>${s(c(a,"name"))}</${t}>`).join("")}
        </div>
      </nav>
      <main class="menu">${u.map(a=>X(a,a.id===e)).join("")}</main>`}function Pe(e){return`
      <main class="menu acc">
        ${u.map(t=>`
          <section class="cat${t.id===e?" open":""}" id="cat-${s(t.id)}" data-cat="${s(t.id)}">
            <div class="wrap">
              <h2 class="acc-h">
                <button type="button" class="acc-head" aria-expanded="${t.id===e}">
                  <span class="cat-name">${s(c(t,"name"))}</span>
                  <span class="acc-count">${W(t.items.length)}</span>
                  <span class="acc-chev" aria-hidden="true"></span>
                </button>
              </h2>
              <div class="acc-body"${t.id===e?"":" hidden"}>
                ${c(t,"description")?`<p class="cat-desc">${s(c(t,"description"))}</p>`:""}
                <div class="items">${t.items.map(J).join("")}</div>
              </div>
            </div>
          </section>`).join("")}
      </main>`}function je(){return`
      <main class="menu tiles-home">
        <div class="wrap">
          <div class="tiles">
            ${u.map(e=>{const t=ve(e);return`
                <a class="tile${t?"":" no-img"}" href="#cat-${s(e.id)}" data-cat="${s(e.id)}">
                  ${t?`<img class="tile-img" src="${s(t)}" alt="" loading="lazy">`:""}
                  <span class="tile-text">
                    <span class="tile-name">${s(c(e,"name"))}</span>
                    <span class="tile-count">${W(e.items.length)}</span>
                  </span>
                </a>`}).join("")}
          </div>
        </div>
      </main>`}function Ee(e){return`
      <nav class="tile-bar">
        <div class="wrap">
          <button type="button" class="tile-back"><span aria-hidden="true">\u2190</span> ${o("back")}</button>
          ${Z()}
        </div>
      </nav>
      <main class="menu">${X(e,!0)}</main>`}const Te=()=>{if(!location.hash.startsWith("#cat-"))return null;const e=decodeURIComponent(location.hash.slice(5));return u.find(t=>t.id===e)||null};let L=null,ee=[],S=[];function k(e){p.lang=d,document.title=i.name?`${i.name} \xB7 ${o("title")}`:o("title");const t=`<main class="menu menu-empty"><div class="wrap"><p>${o("empty")}</p></div></main>`,a=`<dialog class="sheet" aria-label="${o("details")}"></dialog>`,r=h==="tiles"&&Te();if(p.dataset.view=r?"section":"home",r)m.innerHTML=Ee(r)+a;else{let l=t;u.length&&(h==="tiles"?l=je():h==="accordion"?l=Pe(e):l=ke(e||u[0].id)),m.innerHTML=Le()+Se()+l+ye()+a}ee=[...m.querySelectorAll(".chip")],S=[...m.querySelectorAll(".cat")],L&&L.disconnect(),h==="scroll"&&"IntersectionObserver"in window&&(L=new IntersectionObserver(l=>{l.forEach(g=>{g.isIntersecting&&te(g.target.dataset.cat)})},{rootMargin:"-35% 0px -60% 0px"}),S.forEach(l=>L.observe(l)))}function te(e){ee.forEach(t=>{const a=t.dataset.cat===e;t.classList.toggle("active",a),a&&t.parentElement.scrollTo({left:t.offsetLeft-16,behavior:"smooth"})})}function ae(e){S.forEach(a=>a.classList.toggle("active",a.dataset.cat===e)),te(e);const t=h==="bottom"?m.querySelector(".menu").offsetTop:m.querySelector(".catnav").offsetTop;window.scrollY>t&&window.scrollTo({top:t,behavior:"smooth"})}function se(e){S.forEach(t=>{const a=t.dataset.cat===e&&!t.classList.contains("open");t.classList.toggle("open",a),t.querySelector(".acc-body").hidden=!a,t.querySelector(".acc-head").setAttribute("aria-expanded",a),a&&t.scrollIntoView({block:"start"})})}let ne=!1;window.addEventListener("hashchange",()=>{h==="tiles"&&(k(),window.scrollTo(0,0))});function Ue(){if(ne)return history.back();history.replaceState(null,"",location.pathname+location.search),k(),window.scrollTo(0,0)}function He(e){if(e===d)return;if(d=e,fe(C,d),new URLSearchParams(location.search).has("lang")){const r=new URL(location.href);r.searchParams.delete("lang"),history.replaceState(null,"",r)}const t=window.scrollY,a=h==="accordion"?m.querySelector(".cat.open"):m.querySelector(".chip.active");k(a&&a.dataset.cat),window.scrollTo(0,t)}function oe(e){const t=m.querySelector(".sheet"),a=G.get(e);if(!a||typeof t.showModal!="function")return;const r=T(a.price,i),l=c(a,"description");t.innerHTML=`
      <div class="sheet-card">
        <button class="sheet-close" type="button" aria-label="${o("close")}">\xD7</button>
        ${a.image?`<img class="sheet-img" src="${s(a.image)}" alt="">`:""}
        <div class="sheet-body">
          <h3 class="sheet-name">${s(c(a,"name"))}</h3>
          <div class="sheet-sub">
            ${r?`<span class="item-price">${s(r)}</span>`:""}
            ${a.size?`<span class="item-size">${s(Q(a.size))}</span>`:""}
          </div>
          ${l?`<p class="sheet-desc">${s(l)}</p>`:""}
          ${K(a.tags)}
        </div>
      </div>`,t.showModal()}m.addEventListener("click",e=>{const t=e.target.closest(".sheet");if(t){(e.target===t||e.target.closest(".sheet-close"))&&t.close();return}const a=e.target.closest(".lang-switch");if(a)return He(a.dataset.lang);const r=e.target.closest(".chip");if(r&&I)return ae(r.dataset.cat);const l=e.target.closest(".acc-head");if(l)return se(l.closest(".cat").dataset.cat);if(e.target.closest(".tile")&&(ne=!0),e.target.closest(".tile-back"))return Ue();const g=e.target.closest(".item, .feat");g&&oe(g.dataset.id)}),m.addEventListener("keydown",e=>{const t=e.target.closest(".item");t&&(e.key==="Enter"||e.key===" ")&&(e.preventDefault(),oe(t.dataset.id))}),k(),document.body.classList.remove("dm-loading");const P=h!=="tiles"&&location.hash&&m.querySelector(`[id="${CSS.escape(location.hash.slice(1))}"]`);P&&(I?ae(P.dataset.cat):h==="accordion"?se(P.dataset.cat):P.scrollIntoView())})();
