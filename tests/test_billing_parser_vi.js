const fs=require('fs'), vm=require('vm');
const src=fs.readFileSync(require('path').join(__dirname,'..','extension_meta_billing','content.js'),'utf8');
let handler=null;
const text=`Số dư hiện tại\n342.095 đ + bất kỳ khoản phí nào có thể áp dụng\nHiện chưa có khoản thanh toán nào đến hạn.\nBạn sẽ thanh toán khi\nSố dư của bạn đạt\n3.167.945 đ\nVà vào ngày này\n15 Tháng 9, 2026\nBạn sẽ thanh toán bằng\nVisa •••• 7818`;
const ctx={
  console, setTimeout, clearTimeout, setInterval(){}, Date, URL,
  location:{href:'https://business.facebook.com/billing_hub/payment_activity?asset_id=2406791049834352&business_id=789570860334452&payment_account_id=2406791049834352'},
  document:{body:{innerText:text},documentElement:{},addEventListener(){},readyState:'complete',visibilityState:'visible'},
  window:{addEventListener(){}},
  MutationObserver:class{constructor(cb){this.cb=cb} observe(){}},
  chrome:{runtime:{onMessage:{addListener(fn){handler=fn}},sendMessage(){}}},
  globalThis:null
};
ctx.globalThis=ctx;
vm.createContext(ctx); vm.runInContext(src,ctx);
let out; handler({type:'BILLING_SCRAPE'},null,(r)=>out=r);
console.log(JSON.stringify(out,null,2));
if(!out?.ok) process.exit(1);
if(out.account.accountId!=='2406791049834352') process.exit(2);
if(out.account.balance!==342095) process.exit(3);
if(out.account.threshold!==3167945) process.exit(4);
if(out.account.nextBillingDate!=='2026-09-15') process.exit(5);
if(out.account.cardLast4!=='7818') process.exit(6);
