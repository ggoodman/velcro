const IMPORT_EXPORT_RX = /(;|^)(import|export)(\s|{)/gm;

export function isESModule(code: string) {
  return IMPORT_EXPORT_RX.test(code);
}
