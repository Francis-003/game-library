import { createDatabaseClient, createSiteContext, errorResponse, BackendError } from './_qoder/backend.mjs';
import { application } from './routes.mjs';

// 站点公开、无平台登录：席位授权由 routes.mjs 比对服务端生成的 token 完成，
// 因此这里不注入 requireUser，也不需要 Storage 能力。
const handle = application({ db: createDatabaseClient(), BackendError });

Deno.serve(async request => {
  let context;
  try { context = createSiteContext(request); return await handle(context); }
  catch (error) { return errorResponse(error, context?.requestId); }
});
