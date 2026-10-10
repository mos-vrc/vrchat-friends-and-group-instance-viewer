// Origin rules use small URL filters; exact write validation is in the worker.
export function buildApiHeaderRules(extensionId, userAgent) {
  const own = {initiatorDomains:[extensionId],resourceTypes:['xmlhttprequest']};
  const origin = (id, urlFilter, requestMethods) => ({
    id, priority:100,
    action:{type:'modifyHeaders',requestHeaders:[{header:'origin',operation:'set',value:'https://vrchat.com'}]},
    condition:{...own,urlFilter,requestDomains:['vrchat.com'],requestMethods},
  });
  return [{
    id:1001,priority:100,
    action:{type:'modifyHeaders',requestHeaders:[{header:'user-agent',operation:'append',value:userAgent}]},
    condition:{...own,regexFilter:'^https://(vrchat\\.com|api\\.vrchat\\.cloud)/api/1/',requestDomains:['vrchat.com','api.vrchat.cloud']},
  },
  origin(1002,'|https://vrchat.com/api/1/favorites|',['post']),
  origin(1003,'|https://vrchat.com/api/1/favorites/fvrt_*',['delete']),
  origin(1004,'|https://vrchat.com/api/1/favorite/group/',['put']),
  origin(1005,'|https://vrchat.com/api/1/invite/myself/to/',['post'])];
}
