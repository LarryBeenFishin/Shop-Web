/* Adds the shared invoicing program to every tenant admin dashboard. */
(function(){
  function install(){
    const grid=document.querySelector('.admin-action-grid');
    if(!grid){setTimeout(install,80);return;}
    if(grid.querySelector('[data-invoice-card]'))return;
    const logout=grid.querySelector('.logout-card');
    const card=document.createElement('a');
    card.href='/admin/invoice';
    card.className='admin-action-card';
    card.dataset.invoiceCard='true';
    card.innerHTML=`<span class="card-icon-wrap"><svg class="card-svg" viewBox="0 0 64 64"><path d="M16 7h32v50l-6-4-6 4-6-4-6 4-8-5V7z"/><path d="M23 20h18M23 29h18M23 38h11"/><path d="M40 37v9M36 41.5h8"/></svg></span><span class="action-copy"><span class="action-title">Invoice / RO</span><span class="action-subtitle">Estimates, repair orders<br>and invoices</span></span>`;
    if(logout)grid.insertBefore(card,logout);else grid.appendChild(card);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();
