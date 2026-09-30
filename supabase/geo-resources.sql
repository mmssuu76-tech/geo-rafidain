-- GeoRafidain research data catalogue
-- Apply after schema.sql and security-hardening.sql.

begin;

create table if not exists public.geo_resources (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title_ar text not null check (char_length(title_ar) between 3 and 180),
  title_en text not null check (char_length(title_en) between 3 and 180),
  category text not null check (category in ('satellite','climate','terrain','soil','water','population','agriculture','vector')),
  provider text not null check (char_length(provider) between 2 and 180),
  description_ar text not null check (char_length(description_ar) between 20 and 1200),
  research_uses text[] not null default '{}',
  coverage text not null check (char_length(coverage) between 2 and 240),
  temporal_coverage text not null check (char_length(temporal_coverage) between 2 and 180),
  spatial_resolution text not null check (char_length(spatial_resolution) between 2 and 180),
  formats text[] not null default '{}',
  license_name text not null check (char_length(license_name) between 2 and 300),
  license_url text not null check (license_url ~ '^https://'),
  access_url text not null check (access_url ~ '^https://'),
  metadata_url text not null check (metadata_url ~ '^https://'),
  citation_text text not null check (char_length(citation_text) between 10 and 1200),
  tags text[] not null default '{}',
  featured boolean not null default false,
  is_published boolean not null default false,
  source_checked_at date not null default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists geo_resources_public_sort_idx
  on public.geo_resources (is_published, featured desc, title_ar);
create index if not exists geo_resources_category_idx
  on public.geo_resources (category) where is_published;

drop trigger if exists geo_resources_updated_at on public.geo_resources;
create trigger geo_resources_updated_at
  before update on public.geo_resources
  for each row execute procedure public.touch_updated_at();

alter table public.geo_resources enable row level security;

drop policy if exists geo_resources_public_read on public.geo_resources;
create policy geo_resources_public_read
  on public.geo_resources for select to anon
  using (is_published);

drop policy if exists geo_resources_authenticated_read on public.geo_resources;
create policy geo_resources_authenticated_read
  on public.geo_resources for select to authenticated
  using (
    is_published
    or ((select private.is_admin()) and (select private.admin_mfa_ok()))
  );

revoke all on public.geo_resources from public, anon, authenticated;
grant select on public.geo_resources to anon, authenticated;

create or replace function public.admin_upsert_geo_resource(p_resource jsonb)
returns public.geo_resources
language plpgsql
security definer
set search_path = ''
as $$
declare
  resource_id uuid;
  clean_slug text := lower(btrim(coalesce(p_resource->>'slug', '')));
  clean_access_url text := btrim(coalesce(p_resource->>'access_url', ''));
  clean_metadata_url text := btrim(coalesce(p_resource->>'metadata_url', ''));
  clean_license_url text := btrim(coalesce(p_resource->>'license_url', ''));
  saved public.geo_resources;
begin
  if not coalesce((select private.is_admin()), false)
     or not coalesce((select private.admin_mfa_ok()), false) then
    raise exception 'ADMIN_MFA_REQUIRED' using errcode = '42501';
  end if;

  if clean_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception 'INVALID_RESOURCE_SLUG' using errcode = '22023';
  end if;
  if coalesce(p_resource->>'category', '') not in ('satellite','climate','terrain','soil','water','population','agriculture','vector') then
    raise exception 'INVALID_RESOURCE_CATEGORY' using errcode = '22023';
  end if;
  if clean_access_url !~ '^https://' or clean_metadata_url !~ '^https://' or clean_license_url !~ '^https://' then
    raise exception 'HTTPS_URLS_REQUIRED' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_resource->>'title_ar', ''))) < 3
     or char_length(btrim(coalesce(p_resource->>'title_en', ''))) < 3
     or char_length(btrim(coalesce(p_resource->>'description_ar', ''))) < 20 then
    raise exception 'RESOURCE_CONTENT_INCOMPLETE' using errcode = '22023';
  end if;

  if nullif(p_resource->>'id', '') is not null then
    resource_id := (p_resource->>'id')::uuid;
  else
    select id into resource_id from public.geo_resources where slug = clean_slug;
  end if;

  if resource_id is null then
    insert into public.geo_resources (
      slug, title_ar, title_en, category, provider, description_ar, research_uses,
      coverage, temporal_coverage, spatial_resolution, formats, license_name,
      license_url, access_url, metadata_url, citation_text, tags, featured,
      is_published, source_checked_at
    ) values (
      clean_slug,
      btrim(p_resource->>'title_ar'), btrim(p_resource->>'title_en'), p_resource->>'category',
      btrim(p_resource->>'provider'), btrim(p_resource->>'description_ar'),
      array(select jsonb_array_elements_text(coalesce(p_resource->'research_uses', '[]'::jsonb))),
      btrim(p_resource->>'coverage'), btrim(p_resource->>'temporal_coverage'), btrim(p_resource->>'spatial_resolution'),
      array(select jsonb_array_elements_text(coalesce(p_resource->'formats', '[]'::jsonb))),
      btrim(p_resource->>'license_name'), clean_license_url, clean_access_url, clean_metadata_url,
      btrim(p_resource->>'citation_text'),
      array(select jsonb_array_elements_text(coalesce(p_resource->'tags', '[]'::jsonb))),
      coalesce((p_resource->>'featured')::boolean, false),
      coalesce((p_resource->>'is_published')::boolean, false),
      coalesce(nullif(p_resource->>'source_checked_at', '')::date, current_date)
    ) returning * into saved;
  else
    update public.geo_resources set
      slug = clean_slug,
      title_ar = btrim(p_resource->>'title_ar'),
      title_en = btrim(p_resource->>'title_en'),
      category = p_resource->>'category',
      provider = btrim(p_resource->>'provider'),
      description_ar = btrim(p_resource->>'description_ar'),
      research_uses = array(select jsonb_array_elements_text(coalesce(p_resource->'research_uses', '[]'::jsonb))),
      coverage = btrim(p_resource->>'coverage'),
      temporal_coverage = btrim(p_resource->>'temporal_coverage'),
      spatial_resolution = btrim(p_resource->>'spatial_resolution'),
      formats = array(select jsonb_array_elements_text(coalesce(p_resource->'formats', '[]'::jsonb))),
      license_name = btrim(p_resource->>'license_name'),
      license_url = clean_license_url,
      access_url = clean_access_url,
      metadata_url = clean_metadata_url,
      citation_text = btrim(p_resource->>'citation_text'),
      tags = array(select jsonb_array_elements_text(coalesce(p_resource->'tags', '[]'::jsonb))),
      featured = coalesce((p_resource->>'featured')::boolean, false),
      is_published = coalesce((p_resource->>'is_published')::boolean, false),
      source_checked_at = coalesce(nullif(p_resource->>'source_checked_at', '')::date, current_date)
    where id = resource_id
    returning * into saved;
  end if;

  if saved.id is null then
    raise exception 'RESOURCE_NOT_FOUND' using errcode = 'P0002';
  end if;
  return saved;
end;
$$;

create or replace function public.admin_set_geo_resource_published(p_resource_id uuid, p_published boolean)
returns public.geo_resources
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved public.geo_resources;
begin
  if not coalesce((select private.is_admin()), false)
     or not coalesce((select private.admin_mfa_ok()), false) then
    raise exception 'ADMIN_MFA_REQUIRED' using errcode = '42501';
  end if;

  update public.geo_resources
  set is_published = p_published
  where id = p_resource_id
  returning * into saved;

  if saved.id is null then
    raise exception 'RESOURCE_NOT_FOUND' using errcode = 'P0002';
  end if;
  return saved;
end;
$$;

revoke all on function public.admin_upsert_geo_resource(jsonb) from public, anon, service_role;
revoke all on function public.admin_set_geo_resource_published(uuid, boolean) from public, anon, service_role;
grant execute on function public.admin_upsert_geo_resource(jsonb) to authenticated;
grant execute on function public.admin_set_geo_resource_published(uuid, boolean) to authenticated;

insert into public.geo_resources (
  slug, title_ar, title_en, category, provider, description_ar, research_uses,
  coverage, temporal_coverage, spatial_resolution, formats, license_name,
  license_url, access_url, metadata_url, citation_text, tags, featured,
  is_published, source_checked_at
) values
(
  'sentinel-2-l2a', 'مرئيات Sentinel-2 ذات الانعكاس السطحي', 'Copernicus Sentinel-2 Level-2A', 'satellite', 'Copernicus / European Union',
  'مرئيات متعددة الأطياف مناسبة لرصد الغطاء الأرضي والزراعة والمياه والتوسع الحضري، مع منتج انعكاس سطحي جاهز للتحليلات الطيفية.',
  array['NDVI والمؤشرات الطيفية','تصنيف الغطاء الأرضي','رصد التوسع الحضري','مراقبة المياه والزراعة'], 'العراق والعالم', '2015–الوقت الحاضر', '10 / 20 / 60 متر', array['SAFE','JPEG2000','STAC/API'],
  'بيانات Copernicus المجانية والمفتوحة', 'https://dataspace.copernicus.eu/terms-and-conditions', 'https://dataspace.copernicus.eu/explore-data', 'https://dataspace.copernicus.eu/data-collections/copernicus-sentinel-missions/sentinel-2',
  'European Union, Copernicus Sentinel-2 imagery, accessed through the Copernicus Data Space Ecosystem. تاريخ الوصول: [أضف التاريخ].',
  array['Sentinel-2','MSI','مرئيات فضائية','غطاء أرضي','زراعة'], true, true, date '2026-10-01'
),
(
  'landsat-collection-2-l2', 'Landsat Collection 2 – المستوى الثاني', 'USGS Landsat Collection 2 Level-2', 'satellite', 'U.S. Geological Survey (USGS)',
  'سلسلة زمنية طويلة من الانعكاس السطحي وحرارة سطح الأرض، مفيدة لدراسة التغيرات البيئية والعمرانية والمناخية طويلة الأمد.',
  array['تحليل التغير الزمني','حرارة سطح الأرض','التصحر والجفاف','تغير استعمالات الأرض'], 'العراق والعالم', '1982–الوقت الحاضر بحسب القمر والمنتج', '30 متر للانعكاس السطحي', array['GeoTIFF','EarthExplorer'],
  'ملكية عامة – USGS', 'https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits', 'https://earthexplorer.usgs.gov/', 'https://www.usgs.gov/landsat-missions/landsat-collection-2-surface-reflectance',
  'U.S. Geological Survey, Landsat Collection 2 Level-2 product, EarthExplorer. تاريخ الوصول: [أضف التاريخ].',
  array['Landsat','USGS','حرارة السطح','سلسلة زمنية','تغيرات بيئية'], true, true, date '2026-10-01'
),
(
  'era5-single-levels', 'إعادة التحليل المناخي ERA5', 'ERA5 hourly data on single levels', 'climate', 'Copernicus Climate Change Service / ECMWF',
  'بيانات مناخية ساعية عالمية لمتغيرات الغلاف الجوي والسطح، مناسبة لتحليل الاتجاهات والموجات الحرارية والرياح والتبخر والأمطار.',
  array['اتجاهات الحرارة','الرياح والرطوبة','التبخر والميزانية المائية','الدراسات المناخية'], 'العراق والعالم', '1940–الوقت الحاضر', 'شبكة 0.25° تقريباً', array['NetCDF','GRIB'],
  'ترخيص Copernicus C3S', 'https://cds.climate.copernicus.eu/licences/ecmwf', 'https://cds.climate.copernicus.eu/datasets/reanalysis-era5-single-levels', 'https://cds.climate.copernicus.eu/datasets/reanalysis-era5-single-levels?tab=overview',
  'Copernicus Climate Change Service (C3S), ERA5 hourly data on single levels. DOI: 10.24381/cds.adbb2d47. تاريخ الوصول: [أضف التاريخ].',
  array['ERA5','مناخ','حرارة','رياح','أمطار'], true, true, date '2026-10-01'
),
(
  'chirps-v3', 'أمطار CHIRPS الإصدار الثالث', 'CHIRPS v3 Rainfall', 'climate', 'Climate Hazards Center, UC Santa Barbara',
  'سلسلة أمطار شبه عالمية تدمج تقديرات الأقمار الصناعية مع محطات الرصد، وتخدم دراسات الجفاف والتغير المطري والإنذار المبكر.',
  array['تحليل الجفاف','اتجاهات الأمطار','المواسم الزراعية','الإنذار المبكر'], '60° شمالاً إلى 60° جنوباً، ومنها العراق', '1981–قريب من الوقت الحاضر', '0.05° تقريباً', array['GeoTIFF','NetCDF','BIL'],
  'ملكية عامة قدر الإمكان قانوناً', 'https://www.chc.ucsb.edu/data/chirps', 'https://data.chc.ucsb.edu/products/CHIRPS/v3.0/', 'https://www.chc.ucsb.edu/data/chirps3',
  'Climate Hazards Center, CHIRPS v3 rainfall data, UC Santa Barbara. أضف إصدار المنتج والفترة وتاريخ الوصول عند الاستخدام.',
  array['CHIRPS','أمطار','جفاف','مناخ','زراعة'], true, true, date '2026-10-01'
),
(
  'nasadem-hgt', 'نموذج الارتفاع الرقمي NASADEM', 'NASADEM Merged DEM Global 1 arc second', 'terrain', 'NASA LP DAAC',
  'إعادة معالجة محسّنة لبيانات مهمة SRTM لإنتاج نموذج ارتفاع رقمي قريب من العالمي، مناسب لاشتقاق الانحدار واتجاه الجريان وتحليل التضاريس.',
  array['الانحدار والاتجاه','الأحواض والتصريف','التظليل التضاريسي','نمذجة الارتفاع'], 'العراق ومعظم اليابسة بين 60° شمالاً و56° جنوباً', 'اكتساب فبراير 2000', '1 ثانية قوسية، نحو 30 متراً', array['HGT','GeoTIFF عبر أدوات المعالجة'],
  'بيانات NASA Earth Science', 'https://www.earthdata.nasa.gov/engage/open-data-services-and-software/data-and-information-policy', 'https://search.earthdata.nasa.gov/search?q=NASADEM_HGT', 'https://www.earthdata.nasa.gov/centers/lp-daac',
  'NASA JPL, NASADEM Merged DEM Global 1 arc second (NASADEM_HGT.001), distributed by LP DAAC. DOI: 10.5067/MEaSUREs/NASADEM/NASADEM_HGT.001.',
  array['NASADEM','SRTM','DEM','ارتفاع','تضاريس'], false, true, date '2026-10-01'
),
(
  'soilgrids-250m', 'خصائص التربة SoilGrids', 'SoilGrids 250 m', 'soil', 'ISRIC – World Soil Information',
  'خرائط عالمية لخصائص التربة عند أعماق قياسية، تشمل الكربون العضوي والطين والرمل والأس الهيدروجيني والكثافة الظاهرية مع معلومات عدم اليقين.',
  array['ملاءمة الأراضي','خصوبة التربة','نمذجة الكربون','الدراسات الزراعية'], 'العراق والعالم', 'منتج نمذجة عالمي؛ راجع إصدار الطبقة', '250 متر', array['GeoTIFF','WMS','WCS','WebDAV'],
  'CC BY 4.0', 'https://creativecommons.org/licenses/by/4.0/', 'https://isric.org/explore/soilgrids/', 'https://docs.isric.org/globaldata/soilgrids/',
  'Poggio, L. et al. (2021). SoilGrids 2.0: producing soil information for the globe with quantified spatial uncertainty. SOIL, 7, 217–240. DOI: 10.5194/soil-7-217-2021.',
  array['SoilGrids','تربة','كربون عضوي','زراعة','ISRIC'], false, true, date '2026-10-01'
),
(
  'hydrosheds-core-v1-1', 'طبقات HydroSHEDS الهيدرولوجية', 'HydroSHEDS Core v1.1', 'water', 'HydroSHEDS / WWF',
  'طبقات ارتفاع مصححة هيدرولوجياً واتجاه وتراكم الجريان وطول المسار، مفيدة لبناء الأحواض وشبكات التصريف والتحليل الهيدرولوجي.',
  array['استخراج الأحواض','اتجاه الجريان','تراكم الجريان','نمذجة شبكات التصريف'], 'العراق ضمن أوروبا والشرق الأوسط وآسيا', 'مشتق أساساً من SRTM', '3–30 ثانية قوسية ومنتجات أخشن', array['GeoTIFF'],
  'ترخيص HydroSHEDS الخاص؛ يسمح بالاستخدام العلمي والتعليمي والتجاري مع شروط', 'https://www.hydrosheds.org/products/hydrosheds', 'https://www.hydrosheds.org/hydrosheds-core-downloads', 'https://www.hydrosheds.org/products/hydrosheds',
  'Lehner, B., Verdin, K., & Jarvis, A. (2008). New global hydrography derived from spaceborne elevation data. Eos, 89(10), 93–94. DOI: 10.1029/2008EO100001.',
  array['HydroSHEDS','أحواض','تصريف','هيدرولوجيا','جريان'], false, true, date '2026-10-01'
),
(
  'worldpop-global2', 'تقديرات السكان الشبكية WorldPop Global 2', 'WorldPop Global 2 Population Counts', 'population', 'WorldPop, University of Southampton',
  'تقديرات سنوية لتوزيع السكان على شبكة عالية الدقة، مناسبة لدراسات سهولة الوصول والتعرض للمخاطر وتخطيط الخدمات مع مراعاة أنها تقديرات نمذجة وليست تعداداً ميدانياً.',
  array['توزيع السكان','التعرض للمخاطر','إتاحة الخدمات','التحليل الحضري'], 'العراق وأكثر من 240 دولة وإقليماً', '2015–2030 (تقديرات وإسقاطات سنوية)', '100 متر للدول و1 كم للفسيفساء العالمية', array['GeoTIFF','REST API'],
  'راجع ترخيص كل إصدار في صفحة المنتج', 'https://hub.worldpop.org/project/categories?id=3', 'https://hub.worldpop.org/project/categories?id=3', 'https://www.worldpop.org/blog/mapping-people-places-and-change-exploring-worldpops-latest-global-data-releases/',
  'WorldPop, Global 2 Population Data, R2025A v1. استخدم الاقتباس وDOI الظاهرين في صفحة الطبقة والسنة المختارة.',
  array['WorldPop','سكان','ديموغرافيا','مخاطر','خدمات'], true, true, date '2026-10-01'
),
(
  'jrc-global-surface-water', 'المياه السطحية العالمية من JRC', 'JRC Global Surface Water 1984–2024', 'water', 'European Commission Joint Research Centre',
  'خرائط عالية الدقة لتوزيع المياه السطحية وتكرارها وموسميتها وتحولاتها، مناسبة لرصد الأهوار والبحيرات والخزانات وتغير المسطحات المائية.',
  array['تغير مساحة المياه','رصد الأهوار','موسمية المياه','الخزانات والبحيرات'], 'العراق والعالم', '1984–2024', '30 متر', array['GeoTIFF','Web Map','Google Earth Engine'],
  'بيانات Copernicus مجانية دون تقييد استخدام مع وجوب الإسناد', 'https://global-surface-water.appspot.com/download', 'https://global-surface-water.appspot.com/download', 'https://global-surface-water.appspot.com/',
  'Pekel, J.-F. et al. (2016). High-resolution mapping of global surface water and its long-term changes. Nature 540, 418–422. DOI: 10.1038/nature20584. Attribution: EC JRC/Google.',
  array['JRC','مياه سطحية','أهوار','Landsat','تغيرات'], true, true, date '2026-10-01'
),
(
  'fao-wapor-v3', 'إنتاجية المياه الزراعية WaPOR', 'FAO WaPOR v3', 'agriculture', 'Food and Agriculture Organization (FAO)',
  'طبقات استشعار عن بعد لمراقبة إنتاجية المياه والأرض والزراعة، مع إتاحة منتجات المستوى الثالث لمنطقة غرب الغراف والنجف في العراق ضمن تحديثات المنصة.',
  array['إنتاجية المياه','التبخر–نتح','الكتلة الحيوية','إدارة الري'], 'العراق ضمن التغطية العالمية/الإقليمية، وتغطيات محلية مختارة', 'الإصدار 3؛ راجع الفترة الخاصة بكل طبقة', 'تختلف حسب المستوى والمنتج', array['Cloud Optimized GeoTIFF','API','Google Earth Engine'],
  'بيانات FAO المفتوحة؛ راجع شروط الطبقة', 'https://www.fao.org/contact-us/terms/en/', 'https://data.apps.fao.org/wapor/', 'https://www.fao.org/in-action/remote-sensing-for-water-productivity/wapor-data-access/en',
  'FAO, WaPOR v3 – Water Productivity through Open access of Remotely sensed derived data. أضف اسم الطبقة والفترة وتاريخ الوصول.',
  array['WaPOR','FAO','ري','تبخر نتح','زراعة','نجف'], false, true, date '2026-10-01'
),
(
  'openstreetmap-iraq-geofabrik', 'بيانات OpenStreetMap للعراق', 'OpenStreetMap Iraq Extract', 'vector', 'OpenStreetMap contributors / Geofabrik',
  'استخراج متجدد للعراق يضم الطرق والمباني والأماكن والمعالم المضافة إلى OpenStreetMap. جودة واكتمال البيانات يختلفان مكانياً ويجب فحصهما قبل البحث.',
  array['شبكات الطرق','المباني والخدمات','تحليل الوصول','خرائط الأساس'], 'العراق', 'تحديثات دورية قريبة من الوقت الحاضر', 'بيانات متجهة متفاوتة الاكتمال', array['OSM PBF','GeoPackage','Shapefile'],
  'Open Data Commons ODbL 1.0', 'https://www.openstreetmap.org/copyright', 'https://download.geofabrik.de/asia/iraq.html', 'https://download.geofabrik.de/asia.html',
  '© OpenStreetMap contributors, data available under the Open Database License (ODbL); extract provided by Geofabrik. تاريخ الوصول: [أضف التاريخ].',
  array['OSM','طرق','مبانٍ','خدمات','بيانات متجهة','العراق'], false, true, date '2026-10-01'
)
on conflict (slug) do nothing;

select count(*) = 11 as research_resources_ready
from public.geo_resources
where slug in (
  'sentinel-2-l2a','landsat-collection-2-l2','era5-single-levels','chirps-v3',
  'nasadem-hgt','soilgrids-250m','hydrosheds-core-v1-1','worldpop-global2',
  'jrc-global-surface-water','fao-wapor-v3','openstreetmap-iraq-geofabrik'
);

commit;
