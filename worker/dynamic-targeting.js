// Private Worker-only, explainable targeting suggestions. No Meta API verification is implied.
// This is a conservative keyword matcher, NOT an LLM or live targeting catalog.
const profiles = [
  {id:'newborn',match:/newborn|new born|infant|maternit|pregnan|مولود|مواليد|رضيع|حامل|حديثي الولادة/i,
   interests:['Baby shower','Infant or Baby equipment'],demographics:['Parents (up to 12 months)']},
  {id:'toddler',match:/toddler|baby cloth|baby wear|children.?s cloth|kids? wear|ملابس أطفال|ثياب أطفال/i,
   interests:['Baby clothing','Infant or Baby equipment'],demographics:['Parents with toddlers (01-02 years)']},
  {id:'wedding',match:/wedding|bridal|bride|engagement|زفاف|عرس|خطوبة|عروس/i,
   interests:['Wedding planning','Engagement ring'],demographics:[]},
  {id:'jewelry',match:/jewel|jewell|gold|necklace|bracelet|ring|مجوهرات|ذهب|خاتم|قلادة/i,
   interests:['Jewelry','Fashion accessories'],demographics:[]},
  {id:'automotive',match:/car|vehicle|auto|detailing|mechanic|garage|سيارات|سيارة|ميكانيك|تلميع/i,
   interests:['Automobiles','Car care'],demographics:[]},
  {id:'education',match:/cours|training|tutor|school|education|learning|academy|دورات|تعليم|تدريب|مدرسة/i,
   interests:['Education','Online learning'],demographics:[]},
  {id:'fitness',match:/gym|fitness|workout|yoga|personal train|رياضة|لياقة|نادي رياضي/i,
   interests:['Physical fitness','Exercise'],demographics:[]},
  {id:'restaurant',match:/restaurant|cafe|coffee|bakery|food|مطعم|مقهى|قهوة|مخبز/i,
   interests:['Restaurants','Food'],demographics:[]},
  {id:'real-estate',match:/real estate|property|apartment|housing|عقارات|شقق|شقة/i,
   interests:['Real estate'],demographics:[]},
  {id:'fashion',match:/fashion|women.?s cloth|dress|hijab|apparel|أزياء|ملابس نسائية|حجاب|فساتين/i,
   interests:['Fashion','Clothing'],demographics:[]},
  {id:'photography',match:/photo|portrait|تصوير|فوتوغراف/i,
   interests:['Photography'],demographics:[]},
  {id:'technology',match:/software|cloud|computer|cybersecurity|technology|برمجيات|تقنية|تكنولوجيا/i,
   interests:['Technology','Computer software'],demographics:[]}
];
const unique = items => [...new Set(items.filter(Boolean))];
const safeString = x => typeof x==='string'?x:'';
export function recommendTargeting(x) {
  const context=[x.category,x.product,x.description,x.audience].map(safeString).join(' ').slice(0,1500);
  // Product-specific signals take precedence over broad business-category matches.
  const productContext=[x.product,x.description].map(safeString).join(' ');
  const specific=profiles.filter(p=>p.match.test(productContext));
  const matched=specific.length?specific:profiles.filter(p=>p.match.test(context));
  const interests=unique(matched.flatMap(p=>p.interests)).slice(0,6);
  const demographics=unique(matched.flatMap(p=>p.demographics)).slice(0,3);
  const provided=unique(safeString(x.interests).split(',').map(s=>s.trim()).filter(Boolean)).slice(0,8);
  return {
    interests:unique([...interests,...provided]).slice(0,10),
    demographics,
    source:matched.length?'keyword-matched suggestions':'no confident category match',
    matchedProfiles:matched.map(p=>p.id),
    note:'Candidate search terms only; not confirmed Meta targeting options. Check availability, restrictions and Advantage+ expansion in Ads Manager. Do not require all suggestions together.'
  };
}
