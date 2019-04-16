export type CustomFetch = (
  url: string,
  options?: Pick<RequestInit, 'redirect'>
) => Promise<Pick<Response, 'arrayBuffer' | 'ok' | 'status'>>;
