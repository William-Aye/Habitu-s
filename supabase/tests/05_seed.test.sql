begin;
select plan(5);
select is((select count(*) from categories where parent_id is null)::int, 13, '13 top-level categories');
select ok((select count(*) from categories where parent_id is not null) >= 50, 'at least 50 sub-categories');
select is((select count(*) from categories where icon = '' or name_fr = '' or name_en = '')::int, 0, 'every category has icon and both names');
select is((select count(*) from ambiance_words)::int, 11, '11 ambiance words');
select is((select count(*) from categories where name_fr ~ '[\U0001F300-\U0001FAFF☀-➿]')::int, 0, 'no emoji in category names');
select * from finish();
rollback;
