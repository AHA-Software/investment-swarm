const $=id=>document.getElementById(id);
const usd=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n/1e6);
const node=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
async function refresh(){try{
  const response=await fetch('/api/status');if(!response.ok)throw Error('Unable to read state');const data=await response.json(),s=data.state;
  $('equity').textContent=usd(data.equity);$('cash').textContent=usd(s.cash);$('committed').textContent=usd(s.positions.reduce((a,p)=>a+p.cost,0));$('positions').textContent=String(s.positions.length);
  $('mode').textContent=s.fixture?'SYNTHETIC DEMO':s.halted?'PAPER HALTED':s.paused?'PAPER PAUSED':'PAPER ONLY';$('updated').textContent='Updated '+new Date(data.at).toLocaleTimeString();
  $('notice').textContent=s.fixture?'Synthetic fixtures only. Demo results do not count toward live qualification.':s.pauseReason||'Paper research only. No live order submission is implemented.';$('notice').className=s.fixture||s.paused?'notice warning':'notice';
  $('market-count').textContent=`${data.markets.filter(m=>['active','open'].includes(m.status)).length} open contracts`;
  if(data.health.length)$('feeds').replaceChildren(...data.health.map(h=>node('p',`${h.service}: ${h.error||(h.errors?.length?h.errors.join('; '):'OK')} · ${h.at?new Date(h.at).toLocaleTimeString():'no timestamp'}`)));
  $('stations').replaceChildren(...data.samples.map(item=>{const e=node('div',undefined,'station');e.append(node('b',data.cities[item.city].name),node('small',data.cities[item.city].station));const track=node('div',undefined,'track'),bar=node('i');bar.style.width=Math.min(100,item.count/30*100)+'%';track.append(bar);e.append(track,node('small',`${item.count} / 30 settled samples`));return e;}));
  $('position-rows').replaceChildren(...s.positions.map(p=>{const row=node('tr');for(const text of [p.ticker,p.side.toUpperCase(),p.quantity,usd(p.cost),p.exitReason||'Monitoring'])row.append(node('td',String(text)));return row;}));
  if(!s.positions.length){const row=node('tr'),cell=node('td','No open paper positions. Data collection can continue while the models build evidence.','empty');cell.colSpan=5;row.append(cell);$('position-rows').append(row);}
  $('decisions').replaceChildren(...s.decisions.slice(-30).reverse().map(d=>{const e=node('div',undefined,'decision');const detail=node('div');detail.append(node('strong',d.ticker),node('p',d.reasons.join(' · ')));e.append(node('time',new Date(d.timestamp).toLocaleTimeString()),node('b',d.action),detail);return e;}));if(!s.decisions.length)$('decisions').append(node('p','No decisions yet. Start the paper runner or open the isolated demo.','empty'));
}catch(error){$('updated').textContent='Disconnected';$('notice').textContent=error.message;$('notice').className='notice warning';}}
refresh();setInterval(refresh,3000);
