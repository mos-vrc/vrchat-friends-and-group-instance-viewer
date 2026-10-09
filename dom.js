// Reuse unchanged cards and images. Keys are local to each parent; no global
// selectors, template handlers or remote HTML are involved.
function key(node) {
  if (node.nodeType !== 1) return '';
  const data = node.dataset;
  return node.id || (data.friendId ? 'friend:' + data.friendId : '')
    || (data.location ? 'location:' + data.location : '')
    || (data.friendGroup ? 'group:' + data.friendGroup : '')
    || (data.worldId ? 'world:' + data.worldId : '')
    || (data.worldTab ? 'world-tab:' + data.worldTab : '');
}

export function patchElement(current, next) {
  if (current.isEqualNode(next)) return current;
  if (current.nodeType !== next.nodeType || current.nodeName !== next.nodeName) {
    current.replaceWith(next);
    return next;
  }
  if (current.nodeType !== 1) { current.nodeValue = next.nodeValue; return current; }
  const managedImage = current.nodeName === 'IMG' && next.hasAttribute('data-image-src');
  const runtimeAttribute = name => managedImage && ['src', 'data-image-state'].includes(name);
  for (const attr of [...current.attributes]) if (!runtimeAttribute(attr.name) && !next.hasAttribute(attr.name)) current.removeAttribute(attr.name);
  for (const attr of [...next.attributes]) if (current.getAttribute(attr.name) !== attr.value) current.setAttribute(attr.name, attr.value);
  patchChildren(current, next);
  return current;
}

function patchChildren(current, next) {
  const old = [...current.childNodes];
  const keyed = new Map(old.filter(node => key(node)).map(node => [key(node), node]));
  const used = new Set();
  let cursor = current.firstChild;
  for (const desired of [...next.childNodes]) {
    const id = key(desired);
    let existing = id ? keyed.get(id) : cursor;
    if (existing && (used.has(existing) || key(existing) !== id
      || existing.nodeType !== desired.nodeType || existing.nodeName !== desired.nodeName)) existing = null;
    const result = existing ? patchElement(existing, desired) : desired;
    if (result !== cursor) current.insertBefore(result, cursor);
    used.add(result);
    cursor = result.nextSibling;
  }
  for (const node of old) if (!used.has(node) && node.parentNode === current) node.remove();
}

export function patchMarkup(element, markup) {
  const template = document.createElement('template');
  template.innerHTML = markup;
  patchChildren(element, template.content);
}
