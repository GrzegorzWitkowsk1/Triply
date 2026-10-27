import ts from "typescript";
import {readdirSync,readFileSync,writeFileSync,mkdirSync} from "node:fs";
import {dirname,relative,join} from "node:path";
const root="apps/web/src";
const dictionary=new Map(readFileSync(process.env.TEMP+"/triply-translations.tsv","utf8").replace(/^\uFEFF/,'').split(/\r?\n/).filter(x=>x.includes('\t')).map(line=>{const [en,pl]=line.split('\t');return [en,pl.replace('jedzieszz','jedziesz')]}));
const allResources=new Map<string,Record<string,unknown>>();
const namespaces=new Set<string>();
function catalog(lang:string,ns:string):Record<string,unknown>{const id=lang+"/"+ns;if(!allResources.has(id)){let value={};try{value=JSON.parse(readFileSync(root+"/i18n/locales/"+id+".json","utf8"));}catch{}allResources.set(id,value);}namespaces.add(ns);return allResources.get(id)!;}
const generic=new Set(['Save','Cancel','Delete','Confirm','Close','Retry','Add','Save changes','Loading...','Saving...','Try again','Dismiss','Currency','Category','Quantity']);
function entry(text:string,ns:string):string{
 if(generic.has(text))ns='common';
 const en=catalog('en',ns),pl=catalog('pl',ns);
 let key=Object.keys(en).find(key=>en[key]===text);
 if(!key){const words=text.replace(/{{.*?}}/g,' ').replace(/[^a-zA-Z0-9 ]/g,' ').trim().split(/\s+/).slice(0,8);key=words.map((w,i)=>i?w[0].toUpperCase()+w.slice(1).toLowerCase():w.toLowerCase()).join('')||'label';let suffix=2;const original=key;while(key in en)key=original+suffix++;en[key]=text;pl[key]=dictionary.get(text)!;}
 return 'i18n.t('+JSON.stringify(key)+', { ns: '+JSON.stringify(ns)+' })';
}
function namespace(path:string){
 if(/GuestMigration/.test(path))return 'auth/migration';if(/GuestUsage|GuestPage/.test(path))return 'auth/guest';
 if(/profile|ProfilePage/.test(path))return 'auth/profile';if(/\/auth\//.test(path))return 'auth/session';if(/LoginPage/.test(path))return 'auth';
 if(/TripRequirements|tripAnalysis/.test(path))return /schemas/.test(path)?'tripCreator/validation':'tripCreator/fields';
 if(/\/home\/|HomePage|\/config\/home/.test(path))return 'tripCreator/home';
 if(/CollectionPage|\/config\/explore/.test(path))return 'explore/collections';if(/Explore/.test(path))return 'explore';
 if(/PackingSuggestions/.test(path))return 'packing/suggestions';if(/TripEquipment/.test(path))return 'packing';
 if(/saved|Saved|SaveButton|DestinationPlanButton/.test(path))return 'saved';
 if(/TripAssistant/.test(path))return 'assistant';if(/TripBudget/.test(path))return 'expenses';
 if(/TripWeather|\/config\/weather/.test(path))return 'trips/weather';
 if(/TripSharing|TripPdf|TripExport|SharedTrip/.test(path))return 'sharing';
 if(/RegenerateDay/.test(path))return 'itinerary/generation';if(/AttractionPicker|MoveAttraction|TripTimeline|TripAttraction|TripBreak|itineraryAdapters/.test(path))return 'itinerary/editor';
 if(/\/trip\//.test(path)||/TripPage/.test(path))return 'trips/details';
 if(/Notification/.test(path)||/notifications/.test(path))return 'navigation/notifications';if(/layout/.test(path))return 'navigation';
 return 'trips';
}
function isVisibleString(node:ts.StringLiteralLike,source:ts.SourceFile){
 const p=node.parent;
 if(ts.isCallExpression(p) && /^(i18n\.t|t)$/.test(p.expression.getText(source))) return false;
 if(ts.isJsxAttribute(p))return ['label','title','placeholder','aria-label','aria-description','alt','helperText'].includes(p.name.getText(source));
 if(ts.isPropertyAssignment(p)&&p.initializer===node)return !['id','value','type','key','status','role','className','color','code','name','defaultValue'].includes(p.name.getText(source));
 if(ts.isImportDeclaration(p)||ts.isExportDeclaration(p)||ts.isTypeNode(p)||ts.isLiteralTypeNode(p)||ts.isPropertyAssignment(p)&&p.name===node||ts.isArrayLiteralExpression(p))return false;
 if(ts.isBinaryExpression(p)&&p.operatorToken.kind!==ts.SyntaxKind.PlusToken||ts.isCaseClause(p)||ts.isVariableDeclaration(p)&&p.getSourceFile()===source&&!node.getText(source).includes(' '))return false;
 if(ts.isCallExpression(p)&&ts.isIdentifier(p.expression)&&/^(useState|setFilter|setType|setSort|setMode|setView|setConfirm|setOperation|register|watch|getValues|setValue)$/.test(p.expression.text))return false;
 if(ts.isVariableDeclaration(p)&&p.parent.parent.parent===source)return false;
 if(ts.isCallExpression(p)&&/\.includes$|\.indexOf$|\.startsWith$|\.endsWith$|\.getBy|\.querySelector$|addEventListener$|removeEventListener$/.test(p.expression.getText(source)))return false;
 if(ts.isCallExpression(p)&&/sendMessage|\.send/.test(p.expression.getText(source)))return false;
 return true;
}
function migrate(path:string){
 if(/\.test\.|\.d\.ts$|\/i18n\/|\/api\/|theme\.ts|config\/trips\.ts$/.test(path))return;
 let input=readFileSync(path,'utf8');const source=ts.createSourceFile(path,input,ts.ScriptTarget.Latest,true,path.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);const changes:{start:number,end:number,text:string}[]=[];const ns=namespace(path);
 function visit(node:ts.Node){
  if(ts.isTemplateExpression(node)) {
    const text=node.head.text+node.templateSpans.map((span,index)=>"{{value"+index+"}}"+span.literal.text).join("");
    if(dictionary.has(text)) {
      const translated=entry(text,ns).replace(/ \}\)$/, ", "+node.templateSpans.map((span,index)=>"value"+index+": "+span.expression.getText(source)).join(", ")+" })");
      changes.push({start:node.getStart(source),end:node.end,text:translated});return;
    }
  }
  if(ts.isJsxText(node)){const text=node.getText(source).replace(/\s+/g,' ').trim();if(dictionary.has(text))changes.push({start:node.getStart(source),end:node.end,text:'{'+entry(text,ns)+'}'});}
  else if((ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node))&&dictionary.has(node.text)&&isVisibleString(node,source)){
   const translated=entry(node.text,ns);const p=node.parent;
   if(ts.isJsxAttribute(p))changes.push({start:node.getStart(source),end:node.end,text:'{'+translated+'}'});
   else if(ts.isPropertyAssignment(p)&&p.initializer===node){changes.push({start:p.getStart(source),end:p.end,text:'get '+p.name.getText(source)+'() { return '+translated+'; }'});}
   else changes.push({start:node.getStart(source),end:node.end,text:translated});
  }ts.forEachChild(node,visit);
 }visit(source);
 if(!changes.length)return;
 changes.sort((a,b)=>b.start-a.start).forEach(change=>{input=input.slice(0,change.start)+change.text+input.slice(change.end)});
 if(!/import\s+i18n\b|import\s+i18n\s*,/.test(input)){let link=relative(dirname(path),root+'/i18n').replaceAll('\\','/');if(!link.startsWith('.'))link='./'+link;input='import i18n from '+JSON.stringify(link)+';\n'+input;}
 if(path.endsWith('.tsx')){
 const updated=ts.createSourceFile(path,input,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);const inserts:number[]=[];
 function hook(node:ts.Node){if((ts.isFunctionDeclaration(node)||ts.isFunctionExpression(node))&&node.name&&/^[A-Z]/.test(node.name.text)&&node.body&&!node.body.getText(updated).includes('useTranslation('))inserts.push(node.body.getStart(updated)+1);ts.forEachChild(node,hook);}hook(updated);
 for(const position of inserts.sort((a,b)=>b-a))input=input.slice(0,position)+'\n  useTranslation();'+input.slice(position);
 if(inserts.length&&!/import\s*{[^}]*useTranslation/.test(input))input='import { useTranslation } from "react-i18next";\n'+input;
 }
 writeFileSync(path,input);console.log(path+': '+changes.length);
}
function walk(path:string){for(const e of readdirSync(path,{withFileTypes:true})){const p=join(path,e.name).replaceAll('\\','/');if(e.isDirectory())walk(p);else if(/\.tsx?$/.test(p))migrate(p)}}walk(root);
for(const [id,data]of allResources){const path=root+'/i18n/locales/'+id+'.json';mkdirSync(dirname(path),{recursive:true});writeFileSync(path,JSON.stringify(data,null,2)+'\n');}
let manifest=readFileSync(root+'/i18n/namespaces.ts','utf8');const existing=[...manifest.matchAll(/"([^"\n]+)"/g)].map(x=>x[1]);writeFileSync(root+'/i18n/namespaces.ts','/** Feature boundaries shared by runtime loading and translation validation. */\nexport const namespaces = '+JSON.stringify([...new Set([...existing,...namespaces])],null,2)+' as const;\n');
