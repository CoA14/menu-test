/*! Digital menu. All rights reserved. See LICENSE. */
(async function(){"use strict";const{LANGS:b,TAGS:j,SOCIAL:z,translator:le,localized:re,plural:de,linkUrl:E,socialProfile:me,icon:pe,scheduleLines:he,savedLang:ue,saveLang:fe,esc:s,formatPrice:T,getJSON:w}=window.DM,d=document.getElementById("app"),p=document.documentElement,M="dm-lang",U=document.currentScript&&new URL(document.currentScript.src).search||"",ge={sr:{title:"Meni",loadError:"Na\u017Ealost, meni trenutno ne mo\u017Ee da se u\u010Dita. Poku\u0161ajte ponovo za trenutak.",empty:"Meni je u pripremi.<br>Navratite uskoro!",sections:"Kategorije menija",details:"Detalji",close:"Zatvori",soldOut:"Rasprodato",hours:"Radno vreme",address:"Adresa",phone:"Telefon",wifi:"Wi-Fi",password:"Lozinka:",followUs:"Pratite nas",links:"Linkovi",madeBy:"Digitalni meni: {name}",switchLang:"Prebaci na engleski",back:"Nazad",recommended:"Preporu\u010Dujemo"},en:{title:"Menu",loadError:"Sorry, the menu could not be loaded. Please try again in a moment.",empty:"Our menu is being prepared.<br>Please check back soon!",sections:"Menu sections",details:"Item details",close:"Close",soldOut:"Sold out",hours:"Opening hours",address:"Address",phone:"Phone",wifi:"Wi-Fi",password:"Password:",followUs:"Follow us",links:"Links",madeBy:"Digital menu by {name}",switchLang:"Switch to Serbian",back:"Back",recommended:"Recommended"}},C=new URLSearchParams(location.search).get("lang");let m=b.includes(C)?C:ue(M)||"sr";const n=le(ge,()=>m),c=(e,t)=>re(e,t,m);function A(e){return new Promise(t=>{const a=document.createElement("link");a.rel="stylesheet",a.href=e,a.onload=a.onerror=t,document.head.appendChild(a)})}const N=(new URLSearchParams(location.search).get("demo")||"").replace(/[^a-z-]/g,""),x=N?`demo/${N}/`:"content/";let i,B,v,y,H;try{[i,B,H]=await Promise.all([w(`${x}settings.json`),w(`${x}menu.json`),w(`core/brand.json${U}`).catch(()=>({}))]);const e=new URLSearchParams(location.search).get("theme");y=String(e||i.theme||"classic").replace(/[^a-z0-9-]/gi,""),v=await w(`themes/${y}/theme.json`).catch(()=>({})),await A(`themes/${y}/theme.css${U}`)}catch(e){d.innerHTML=`<p class="dm-error">${n("loadError")}</p>`,document.body.classList.remove("dm-loading"),console.error(e);return}const D=i.english!==!1;D||(m="sr"),p.dataset.theme=y;const $e=["list","cards","text"];p.dataset.layout=[new URLSearchParams(location.search).get("items"),i.itemStyle,v.layout].find(e=>$e.includes(e))||"list";const be=["scroll","tabs","bottom","tiles","accordion"],h=[new URLSearchParams(location.search).get("layout"),i.layout,v.nav].find(e=>be.includes(e))||"scroll";p.dataset.nav=h;const F=new URLSearchParams(location.search),$=(v.palettes||[]).find(e=>e.id===(F.get("palette")||i.palette));$&&(Object.entries($.vars||{}).forEach(([e,t])=>p.style.setProperty(e,t)),$.scheme&&(p.style.colorScheme=$.scheme)),i.accent&&p.style.setProperty("--accent",i.accent);const Y=$&&$.themeColor||v.themeColor;Y&&(document.querySelector('meta[name="theme-color"]').content=Y);const _=F.get("font")||i.font;if(_){const t=(await w(`core/fonts.json${U}`).catch(()=>[])).find(a=>a.id===_);t&&(await A(t.css),p.style.setProperty("--font-head",t.head),p.style.setProperty("--font-body",t.body),p.style.setProperty("--font-display",t.head),p.style.setProperty("font-synthesis-weight","none"))}const u=(B.categories||[]).filter(e=>(e.items||[]).length),G=new Map;u.forEach(e=>e.items.forEach(t=>G.set(t.id,t)));const I=h==="tabs"||h==="bottom",V=i.featured?u.flatMap(e=>e.items).filter(e=>e.available!==!1&&(e.tags||[]).some(t=>t==="popular"||t==="new")).slice(0,8):[],we=e=>e.image||(e.items.find(t=>t.image)||{}).image||"",W=e=>`${e} ${de(e,m,{sr:["stavka","stavke","stavki"],en:["item","items"]})}`;function K(e){const t=(e||[]).filter(a=>j[a]);return t.length?`<ul class="tags">${t.map(a=>`<li class="tag tag-${a}"><span class="tag-icon" aria-hidden="true">${j[a].icon}</span>${j[a][m]}</li>`).join("")}</ul>`:""}function J(e){const t=e.available===!1,a=T(e.price,i),l=c(e,"description");return`
      <article class="item${e.image?" has-img":""}${t?" soldout":""}" data-id="${s(e.id)}" tabindex="0" role="button" aria-label="${s(c(e,"name"))}">
        ${e.image?`<img class="item-img" src="${s(e.image)}" alt="" loading="lazy">`:""}
        <div class="item-body">
          <div class="item-head">
            <h3 class="item-name">${s(c(e,"name"))}</h3>
            <span class="leader" aria-hidden="true"></span>
            ${a?`<span class="item-price">${s(a)}</span>`:""}
          </div>
          ${l?`<p class="item-desc">${s(l)}</p>`:""}
          <div class="item-meta">
            ${e.size?`<span class="item-size">${s(Q(e.size))}</span>`:""}
            ${t?`<span class="soldout-badge">${n("soldOut")}</span>`:""}
            ${K(e.tags)}
          </div>
        </div>
      </article>`}function ve(){const e=i,t=c(e,"note"),a=[],l=he(e.schedule,m);if(l.length?a.push([n("hours"),`<span class="hours">${l.map(o=>`<span>${s(o.days)}</span><span>${s(o.times)}</span>`).join("")}</span>`]):c(e,"hours")&&a.push([n("hours"),s(c(e,"hours")).replace(/\n/g,"<br>")]),e.address){const o=e.location?`${e.location.lat},${e.location.lng}`:e.address;a.push([n("address"),`<a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(o)}" target="_blank" rel="noopener">${s(e.address)}</a>`])}e.phone&&a.push([n("phone"),`<a href="tel:${s(e.phone.replace(/[^\d+]/g,""))}">${s(e.phone)}</a>`]),e.wifiName&&a.push([n("wifi"),`${s(e.wifiName)}${e.wifiPassword?`<br><span class="muted">${n("password")}</span> ${s(e.wifiPassword)}`:""}`]);const r=o=>`<span class="info-links">${o.map(([f,He,Ie])=>`<a href="${s(Ie)}" target="_blank" rel="noopener">${pe(f)}<span>${s(He)}</span></a>`).join("")}</span>`,g=Object.keys(z).map(o=>[o,me(e[o],o)]).filter(([,o])=>o).map(([o,f])=>[o,f.handle?`@${f.handle}`:z[o].label,f.url]);g.length&&a.push([n("followUs"),r(g)]);const R=E(e.website),ie=[...R?[["website",new URL(R).hostname.replace(/^www\./,""),R]]:[],...(e.links||[]).map(o=>["link",o.label||o.url,E(o.url)]).filter(([,o,f])=>o&&f)];ie.length&&a.push([n("links"),r(ie)]);const ce=E(H.url),O=s(H.name||""),q=O?n("madeBy",{name:ce?`<a href="${s(ce)}" target="_blank" rel="noopener">${O}</a>`:O}):"";return!a.length&&!t&&!q?"":`
      <footer class="info">
        <div class="wrap">
          ${a.length?`<dl class="info-grid">${a.map(([o,f])=>`<div><dt>${o}</dt><dd>${f}</dd></div>`).join("")}</dl>`:""}
          ${t?`<p class="info-note">${s(t)}</p>`:""}
          ${q?`<p class="info-credit">${q}</p>`:""}
        </div>
      </footer>`}function Z(){return D?`
      <button type="button" class="lang-switch" data-lang="${b[(b.indexOf(m)+1)%b.length]}" aria-label="${n("switchLang")}">
        ${b.map(t=>`<span class="lang-btn${t===m?" active":""}" lang="${t}">${t.toUpperCase()}</span>`).join("")}
      </button>`:""}const Q=e=>m==="en"?e.replace(/\bkom\b/,"pcs"):e;function ye(){const e=c(i,"tagline");return`
      <header class="hero">
        ${Z()}
        <div class="wrap">
          ${i.logo?`<img class="hero-logo" src="${s(i.logo)}" alt="">`:""}
          <h1 class="hero-name">${s(i.name||n("title"))}</h1>
          ${e?`<p class="hero-tagline">${s(e)}</p>`:""}
        </div>
      </header>`}function Le(){return V.length?`
      <section class="featured" aria-label="${n("recommended")}">
        <div class="wrap"><h2 class="featured-title">${n("recommended")}</h2></div>
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
      </section>`}function Se(e){const t=I?"button":"a";return`
      <nav class="catnav" aria-label="${n("sections")}">
        <div class="catnav-inner">
          ${u.map(a=>`<${t} class="chip${a.id===e?" active":""}" data-cat="${s(a.id)}"${t==="a"?` href="#cat-${s(a.id)}"`:' type="button"'}>${s(c(a,"name"))}</${t}>`).join("")}
        </div>
      </nav>
      <main class="menu">${u.map(a=>X(a,a.id===e)).join("")}</main>`}function ke(e){return`
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
      </main>`}function Pe(){return`
      <main class="menu tiles-home">
        <div class="wrap">
          <div class="tiles">
            ${u.map(e=>{const t=we(e);return`
                <a class="tile${t?"":" no-img"}" href="#cat-${s(e.id)}" data-cat="${s(e.id)}">
                  ${t?`<img class="tile-img" src="${s(t)}" alt="" loading="lazy">`:""}
                  <span class="tile-text">
                    <span class="tile-name">${s(c(e,"name"))}</span>
                    <span class="tile-count">${W(e.items.length)}</span>
                  </span>
                </a>`}).join("")}
          </div>
        </div>
      </main>`}function je(e){return`
      <nav class="tile-bar">
        <div class="wrap">
          <button type="button" class="tile-back"><span aria-hidden="true">\u2190</span> ${n("back")}</button>
          ${Z()}
        </div>
      </nav>
      <main class="menu">${X(e,!0)}</main>`}const Ee=()=>{if(!location.hash.startsWith("#cat-"))return null;const e=decodeURIComponent(location.hash.slice(5));return u.find(t=>t.id===e)||null};let L=null,ee=[],S=[];function k(e){p.lang=m,document.title=i.name?`${i.name} \xB7 ${n("title")}`:n("title");const t=`<main class="menu menu-empty"><div class="wrap"><p>${n("empty")}</p></div></main>`,a=`<dialog class="sheet" aria-label="${n("details")}"></dialog>`,l=h==="tiles"&&Ee();if(p.dataset.view=l?"section":"home",l)d.innerHTML=je(l)+a;else{let r=t;u.length&&(h==="tiles"?r=Pe():h==="accordion"?r=ke(e):r=Se(e||u[0].id)),d.innerHTML=ye()+Le()+r+ve()+a}ee=[...d.querySelectorAll(".chip")],S=[...d.querySelectorAll(".cat")],L&&L.disconnect(),h==="scroll"&&"IntersectionObserver"in window&&(L=new IntersectionObserver(r=>{r.forEach(g=>{g.isIntersecting&&te(g.target.dataset.cat)})},{rootMargin:"-35% 0px -60% 0px"}),S.forEach(r=>L.observe(r)))}function te(e){ee.forEach(t=>{const a=t.dataset.cat===e;t.classList.toggle("active",a),a&&t.parentElement.scrollTo({left:t.offsetLeft-16,behavior:"smooth"})})}function ae(e){S.forEach(a=>a.classList.toggle("active",a.dataset.cat===e)),te(e);const t=h==="bottom"?d.querySelector(".menu").offsetTop:d.querySelector(".catnav").offsetTop;window.scrollY>t&&window.scrollTo({top:t,behavior:"smooth"})}function se(e){S.forEach(t=>{const a=t.dataset.cat===e&&!t.classList.contains("open");t.classList.toggle("open",a),t.querySelector(".acc-body").hidden=!a,t.querySelector(".acc-head").setAttribute("aria-expanded",a),a&&t.scrollIntoView({block:"start"})})}let ne=!1;window.addEventListener("hashchange",()=>{h==="tiles"&&(k(),window.scrollTo(0,0))});function Te(){if(ne)return history.back();history.replaceState(null,"",location.pathname+location.search),k(),window.scrollTo(0,0)}function Ue(e){if(e===m)return;if(m=e,fe(M,m),new URLSearchParams(location.search).has("lang")){const l=new URL(location.href);l.searchParams.delete("lang"),history.replaceState(null,"",l)}const t=window.scrollY,a=h==="accordion"?d.querySelector(".cat.open"):d.querySelector(".chip.active");k(a&&a.dataset.cat),window.scrollTo(0,t)}function oe(e){const t=d.querySelector(".sheet"),a=G.get(e);if(!a||typeof t.showModal!="function")return;const l=T(a.price,i),r=c(a,"description");t.innerHTML=`
      <div class="sheet-card">
        <button class="sheet-close" type="button" aria-label="${n("close")}">\xD7</button>
        ${a.image?`<img class="sheet-img" src="${s(a.image)}" alt="">`:""}
        <div class="sheet-body">
          <h3 class="sheet-name">${s(c(a,"name"))}</h3>
          <div class="sheet-sub">
            ${l?`<span class="item-price">${s(l)}</span>`:""}
            ${a.size?`<span class="item-size">${s(Q(a.size))}</span>`:""}
            ${a.available===!1?`<span class="soldout-badge">${n("soldOut")}</span>`:""}
          </div>
          ${r?`<p class="sheet-desc">${s(r)}</p>`:""}
          ${K(a.tags)}
        </div>
      </div>`,t.showModal()}d.addEventListener("click",e=>{const t=e.target.closest(".sheet");if(t){(e.target===t||e.target.closest(".sheet-close"))&&t.close();return}const a=e.target.closest(".lang-switch");if(a)return Ue(a.dataset.lang);const l=e.target.closest(".chip");if(l&&I)return ae(l.dataset.cat);const r=e.target.closest(".acc-head");if(r)return se(r.closest(".cat").dataset.cat);if(e.target.closest(".tile")&&(ne=!0),e.target.closest(".tile-back"))return Te();const g=e.target.closest(".item, .feat");g&&oe(g.dataset.id)}),d.addEventListener("keydown",e=>{const t=e.target.closest(".item");t&&(e.key==="Enter"||e.key===" ")&&(e.preventDefault(),oe(t.dataset.id))}),k(),document.body.classList.remove("dm-loading");const P=h!=="tiles"&&location.hash&&d.querySelector(`[id="${CSS.escape(location.hash.slice(1))}"]`);P&&(I?ae(P.dataset.cat):h==="accordion"?se(P.dataset.cat):P.scrollIntoView())})();
