-- Plan feature lists that match the limits, and no public support address until one is chosen
-- (feedback then goes to the admin emails).
update public.plans set features = '["1 portfolio and 25 holdings","Daily PSX prices and fund NAVs","Forecasts and 2 goals","Risk overview","In-app alerts, with 3 price alerts of your own","The weekly digest by email","5 AI questions a month"]'::jsonb where id = 'free';
update public.plans set features = '["20 portfolios and 1,000 holdings","Stress tests, optimizer, tax and zakat","50 price alerts, and every alert by email","Performance tracking","100 AI questions a month","AI statement import"]'::jsonb where id = 'pro';
update public.app_settings set value = '""'::jsonb where key = 'support_email';
