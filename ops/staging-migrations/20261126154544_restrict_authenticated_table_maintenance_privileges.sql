REVOKE TRUNCATE, TRIGGER, REFERENCES, MAINTAIN ON TABLE public.admin_audit_logs, public.admin_retention_queue, public.profiles, public.request_files, public.research_projects, public.service_requests FROM authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE TRUNCATE, TRIGGER, REFERENCES, MAINTAIN ON TABLES FROM authenticated;
