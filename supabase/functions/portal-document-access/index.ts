import {corsHeaders,json} from '../_shared/http.ts';
import {admin,requirePortalUser} from '../_shared/supabase.ts';
import {createDocumentUpload,scanAndPromoteDocument,DocumentError,DOCUMENT_BUCKET} from '../_shared/document-security.ts';

// Legacy authenticated portal entry point uses the same quarantine as the current gateway.
Deno.serve(async request=>{
 if(request.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
 try{
  const {user,clientId}=await requirePortalUser(request),body=await request.json();
  if(body.action==='upload'){
   const result=await createDocumentUpload(admin,{clientId,uploadedBy:user.id,uploadedByPatient:true,fileName:body.fileName,mimeType:body.mimeType,sizeBytes:body.size,title:body.title,category:body.category});
   return json(result);
  }
  if(body.action==='complete_upload')return json(await scanAndPromoteDocument(admin,body.documentId,{clientId}));
  if(body.action==='download'){
   const {data:doc,error:lookup}=await admin.from('patient_documents').select('id,storage_path,storage_bucket,scan_status').eq('id',body.documentId).eq('client_id',clientId).eq('visibility','patient_published').eq('review_status','approved').is('removed_at',null).maybeSingle();
   if(lookup)throw lookup;
   if(!doc||doc.scan_status!=='clean'||doc.storage_bucket!==DOCUMENT_BUCKET)return json({error:'NOT_FOUND'},404);
   const {data,error}=await admin.storage.from(DOCUMENT_BUCKET).createSignedUrl(doc.storage_path,90);if(error)throw error;
   await admin.from('portal_access_audit').insert({auth_user_id:user.id,client_id:clientId,action:'document_download',resource_type:'patient_document',resource_id:doc.id});
   return json({url:data.signedUrl,expiresIn:90});
  }
  return json({error:'INVALID_ACTION'},400);
 }catch(error){const code=error instanceof DocumentError?error.message:error instanceof Error&&['UNAUTHORIZED','FORBIDDEN'].includes(error.message)?error.message:'DOCUMENT_UNAVAILABLE';return json({error:code},error instanceof DocumentError?error.status:code==='UNAUTHORIZED'?401:code==='FORBIDDEN'?403:500);}
});
