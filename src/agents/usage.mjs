// SDK modelUsage is cumulative across resume; report only the current request.
export function requestUsage(result, fallback, previous, resumed = false) {
  const models=Object.values(result.modelUsage||{});
  const keys=['inputTokens','outputTokens','cacheReadInputTokens','cacheCreationInputTokens'];
  if (resumed) {
    if (!previous || !models.length || Object.keys(previous).some(id=>!result.modelUsage[id])) return {...fallback,usageScope:'main-loop'};
    const delta=Object.fromEntries(keys.map(key=>[key,0]));
    for(const [id,u] of Object.entries(result.modelUsage))for(const key of keys){
      const d=(u[key]||0)-(previous[id]?.[key]||0);
      if(d<0)return {...fallback,usageScope:'main-loop'};
      delta[key]+=d;
    }
    return {...delta,usageScope:'request'};
  }
  const sum=key=>models.reduce((n,m)=>n+(m[key]||0),0);
  return models.length?{inputTokens:sum('inputTokens'),outputTokens:sum('outputTokens'),cacheReadInputTokens:sum('cacheReadInputTokens'),cacheCreationInputTokens:sum('cacheCreationInputTokens'),usageScope:'request'}:{...fallback,usageScope:'main-loop'};
}
