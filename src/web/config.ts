// Public configuration for the hosted web edition. The publishable key is safe in the browser:
// every table is protected by row-level security.
export const SUPABASE_URL = 'https://qgmltrboyhnwnugyrcek.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_abmBtcqUF7AiTFJ2-J3eIg_Ny0nqKCk';
export const FN_URL = `${SUPABASE_URL}/functions/v1`;
/** Browser copy of the signed-out demo workspace. */
export const DEMO_KEY = 'arzish.workspace.demo';
export const userKey = (id: string): string => `arzish.workspace.v1:${id}`;
