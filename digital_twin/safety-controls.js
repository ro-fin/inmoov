// Home-relative command units. These are not measured physical degrees.
export function offsetFromPulse(rule,us) {
  if(us===rule.homeUs) return 0;
  return us<rule.homeUs ? (rule.homeUs-us)*rule.offsetMax/(rule.homeUs-rule.minUs)
    : rule.offsetMin ? (us-rule.homeUs)*rule.offsetMin/(rule.maxUs-rule.homeUs) : 0;
}
export function pulseFromOffset(rule,value) {
  if(!Number.isFinite(value)||value<rule.offsetMin||value>rule.offsetMax) throw Error('Use a value inside the safe range.');
  const pulse=value>=0 ? rule.homeUs-value*(rule.homeUs-rule.minUs)/rule.offsetMax
    : rule.homeUs+value*(rule.maxUs-rule.homeUs)/rule.offsetMin;
  return Math.round(pulse);
}
export function rawCommand(rule,us) {
  if(us===rule.homeUs) return rule.rawHome;
  return rule.pin===5 ? rule.rawHome+(us-rule.homeUs)*(rule.rawHome-rule.rawMin)/(rule.homeUs-rule.minUs)
    : (us-500)*270/2000;
}
export function pulseToVisual(rule,us,range) {
  if(us<=rule.homeUs) return (rule.homeUs-us)*range[0]/(rule.homeUs-rule.minUs);
  return rule.maxUs>rule.homeUs ? (us-rule.homeUs)*range[1]/(rule.maxUs-rule.homeUs) : 0;
}
export function visualToPulse(rule,angle,range) {
  if(angle>=0) return rule.homeUs-angle*(rule.homeUs-rule.minUs)/range[0];
  return range[1]<0 ? rule.homeUs+angle*(rule.maxUs-rule.homeUs)/range[1] : rule.homeUs;
}
