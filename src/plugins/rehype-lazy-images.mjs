/**
 * Every image in a post body loads lazily.
 *
 * Astro emits a remote markdown image as a bare `<img src alt>`, so the
 * heaviest post on this site downloaded seventeen of them -- 695,921 bytes --
 * before a reader had scrolled past the first paragraph. Resizing them is not
 * the lever: they are screenshots, and `c_limit` does not upscale, so the same
 * set at w_800 measured 9% smaller. Not fetching them until they are needed is.
 *
 * `decoding="async"` goes with it so a large image cannot block painting the
 * text around it.
 *
 * The hero image is rendered by the page from frontmatter, not from the body,
 * so nothing here is above the fold and there is no first image to exempt.
 */
export function rehypeLazyImages() {
  return (tree) => {
    visit(tree, (node) => {
      if (node.type !== 'element' || node.tagName !== 'img') return;
      node.properties = node.properties ?? {};
      // Not overwritten: an author who wrote loading="eager" meant it.
      if (node.properties.loading === undefined) node.properties.loading = 'lazy';
      if (node.properties.decoding === undefined) node.properties.decoding = 'async';
    });
  };
}

/** A tiny walker, so this plugin pulls in no dependency of its own. */
function visit(node, fn) {
  fn(node);
  for (const child of node.children ?? []) visit(child, fn);
}
