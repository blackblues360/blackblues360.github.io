const lengths = [31,28,31,30,31,30,31,31,30,31,30,31];
export const leapYear = year => year%4===0 && (year%100!==0 || year%400===0);
export function parseDate(text) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error('请输入有效的公历日期');
  const [year,month,day]=text.split('-').map(Number);
  if(year<1||year>9999||month<1||month>12||day<1||day>(month===2&&leapYear(year)?29:lengths[month-1])) throw new Error('请输入有效的公历日期');
  return {year,month,day};
}
export function calendarDay({year,month,day}) {
  const prior=year-1;
  return prior*365+Math.floor(prior/4)-Math.floor(prior/100)+Math.floor(prior/400)
    +lengths.slice(0,month-1).reduce((sum,n)=>sum+n,0)+(month>2&&leapYear(year)?1:0)+day-1;
}
export function anniversaryStats(eventDate,repeat,today=new Date()) {
  const event=parseDate(eventDate),now={year:today.getFullYear(),month:today.getMonth()+1,day:today.getDate()};
  const passed=calendarDay(now)-calendarDay(event);
  if(!repeat) return {passed,remaining:-passed,next:eventDate};
  let year=Math.max(now.year,event.year);
  let next={...event,year,day:event.month===2&&event.day===29&&!leapYear(year)?28:event.day};
  if(calendarDay(next)<calendarDay(now)){year++;next={...event,year,day:event.month===2&&event.day===29&&!leapYear(year)?28:event.day};}
  if(year>9999)return {passed,remaining:null,next:null};
  return {passed,remaining:calendarDay(next)-calendarDay(now),next:`${year}-${String(next.month).padStart(2,'0')}-${String(next.day).padStart(2,'0')}`};
}
