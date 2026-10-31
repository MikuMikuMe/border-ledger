export function isPublicAddress(value:string): boolean;
export function resolvePublicAddress(host:string, lookup:(host:string, options:any) => Promise<Array<{address:string;family:number}>>):Promise<{address:string;family:number}>;
