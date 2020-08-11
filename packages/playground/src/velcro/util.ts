export function readUrl(href: string) {
  return fetch(href).then((res) => {
    if (!res.ok) {
      return Promise.reject(
        new Error(
          `Error while fetching from '${href}' with status: ${res.status} ${res.statusText}`
        )
      );
    }

    return res.arrayBuffer();
  });
}
