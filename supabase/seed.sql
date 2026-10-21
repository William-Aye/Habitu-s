-- Seed data: categories (top-level + children) and ambiance words.
-- Idempotent: every insert uses on conflict (slug) do nothing.
-- Slugs are stable identifiers referenced by other sub-projects; do not rename.

-- Top-level categories
insert into public.categories (slug, name_fr, name_en, icon, sort_order) values
  ('sport',      'Sport',                          'Sport',            'dumbbell',   1),
  ('outdoors',   'Plein air',                      'Outdoors',         'trees',      2),
  ('games',      'Jeux',                           'Games',            'dice-5',     3),
  ('music',      'Musique',                        'Music',            'music',      4),
  ('arts',       'Arts et loisirs créatifs',       'Arts & crafts',    'palette',    5),
  ('dance',      'Danse',                          'Dance',            'footprints', 6),
  ('culture',    'Culture',                        'Culture',          'book-open',  7),
  ('tech',       'Tech et sciences',               'Tech & science',   'cpu',        8),
  ('languages',  'Langues',                        'Languages',        'languages',  9),
  ('food',       'Cuisine',                        'Food & drink',     'chef-hat',   10),
  ('social',     'Solidarité',                     'Volunteering',     'hand-heart', 11),
  ('wellbeing',  'Bien-être',                      'Wellbeing',        'leaf',       12),
  ('family',     'Parents',                        'Parents',          'baby',       13)
on conflict (slug) do nothing;

-- Child categories (slug = parent-child, parent resolved by slug)
insert into public.categories (parent_id, slug, name_fr, name_en, icon, sort_order)
select p.id, v.slug, v.name_fr, v.name_en, v.icon, v.sort_order
from (values
  -- sport
  ('sport', 'sport-course-a-pied',      'Course à pied',         'Running',                  'dumbbell', 1),
  ('sport', 'sport-escalade',           'Escalade',              'Climbing',                 'dumbbell', 2),
  ('sport', 'sport-randonnee',          'Randonnée',             'Hiking',                   'dumbbell', 3),
  ('sport', 'sport-velo',               'Vélo',                  'Cycling',                  'dumbbell', 4),
  ('sport', 'sport-natation',           'Natation',              'Swimming',                 'dumbbell', 5),
  ('sport', 'sport-sports-collectifs',  'Sports collectifs',     'Team sports',              'dumbbell', 6),
  ('sport', 'sport-arts-martiaux',      'Arts martiaux',         'Martial arts',             'dumbbell', 7),
  ('sport', 'sport-yoga',               'Yoga',                  'Yoga',                     'dumbbell', 8),
  ('sport', 'sport-danse-sportive',     'Danse sportive',        'Competitive dance',        'dumbbell', 9),
  -- outdoors
  ('outdoors', 'outdoors-jardinage',           'Jardinage',               'Gardening',              'trees', 1),
  ('outdoors', 'outdoors-observation-oiseaux', 'Observation des oiseaux', 'Birdwatching',           'trees', 2),
  ('outdoors', 'outdoors-balades-nature',      'Balades nature',          'Nature walks',           'trees', 3),
  -- games
  ('games', 'games-jeux-de-societe', 'Jeux de société', 'Board games',       'dice-5', 1),
  ('games', 'games-echecs',          'Échecs',          'Chess',             'dice-5', 2),
  ('games', 'games-go',              'Jeu de go',       'Go',                'dice-5', 3),
  ('games', 'games-jeux-de-role',    'Jeux de rôle',    'Role-playing games', 'dice-5', 4),
  ('games', 'games-jeux-video',      'Jeux vidéo',      'Video games',       'dice-5', 5),
  ('games', 'games-cartes',          'Cartes',          'Card games',        'dice-5', 6),
  -- music
  ('music', 'music-chorale',      'Chorale',          'Choir',                'music', 1),
  ('music', 'music-groupe-jam',   'Groupe / jam',     'Band / jam',           'music', 2),
  ('music', 'music-instruments',  'Instruments',      'Instruments',          'music', 3),
  ('music', 'music-ecoute',       'Écoute',           'Listening',            'music', 4),
  -- arts
  ('arts', 'arts-dessin-peinture', 'Dessin et peinture', 'Drawing and painting', 'palette', 1),
  ('arts', 'arts-photographie',    'Photographie',       'Photography',          'palette', 2),
  ('arts', 'arts-couture-tricot',  'Couture et tricot',  'Sewing and knitting',  'palette', 3),
  ('arts', 'arts-poterie',         'Poterie',            'Pottery',              'palette', 4),
  ('arts', 'arts-origami',         'Origami',            'Origami',              'palette', 5),
  -- dance
  ('dance', 'dance-danse-de-salon',         'Danse de salon',         'Ballroom dance',      'footprints', 1),
  ('dance', 'dance-salsa-bachata',          'Salsa et bachata',       'Salsa and bachata',   'footprints', 2),
  ('dance', 'dance-danses-traditionnelles', 'Danses traditionnelles', 'Traditional dance',   'footprints', 3),
  ('dance', 'dance-danse-contemporaine',    'Danse contemporaine',    'Contemporary dance',  'footprints', 4),
  -- culture
  ('culture', 'culture-lecture',         'Lecture et clubs de lecture', 'Reading and book clubs', 'book-open', 1),
  ('culture', 'culture-theatre',         'Théâtre',                     'Theatre',                'book-open', 2),
  ('culture', 'culture-cinema',          'Cinéma',                      'Cinema',                 'book-open', 3),
  ('culture', 'culture-histoire-patrimoine', 'Histoire et patrimoine',  'History and heritage',   'book-open', 4),
  ('culture', 'culture-ecriture',        'Écriture',                    'Writing',                'book-open', 5),
  -- tech
  ('tech', 'tech-programmation', 'Programmation',        'Programming',        'cpu', 1),
  ('tech', 'tech-arduino',       'Électronique et Arduino', 'Electronics and Arduino', 'cpu', 2),
  ('tech', 'tech-robotique',     'Robotique',            'Robotics',           'cpu', 3),
  ('tech', 'tech-astronomie',    'Astronomie',           'Astronomy',          'cpu', 4),
  ('tech', 'tech-sciences',      'Sciences',             'Science',            'cpu', 5),
  -- languages
  ('languages', 'languages-echange-linguistique', 'Échange linguistique', 'Language exchange', 'languages', 1),
  ('languages', 'languages-anglais',              'Anglais',              'English',           'languages', 2),
  ('languages', 'languages-espagnol',             'Espagnol',             'Spanish',           'languages', 3),
  ('languages', 'languages-autres',               'Autres langues',       'Other languages',   'languages', 4),
  -- food
  ('food', 'food-cuisine',    'Cuisine',     'Cooking',     'chef-hat', 1),
  ('food', 'food-patisserie', 'Pâtisserie',  'Baking',      'chef-hat', 2),
  ('food', 'food-degustation', 'Dégustation', 'Tasting',     'chef-hat', 3),
  -- social
  ('social', 'social-benevolat',       'Bénévolat',        'Volunteering',       'hand-heart', 1),
  ('social', 'social-aide-aux-devoirs', 'Aide aux devoirs', 'Homework help',      'hand-heart', 2),
  ('social', 'social-environnement',   'Environnement',    'Environment',        'hand-heart', 3),
  -- wellbeing
  ('wellbeing', 'wellbeing-meditation',   'Méditation',   'Meditation',    'leaf', 1),
  ('wellbeing', 'wellbeing-marche-douce', 'Marche douce', 'Gentle walking', 'leaf', 2),
  ('wellbeing', 'wellbeing-sophrologie',  'Sophrologie',  'Sophrology',    'leaf', 3),
  -- family
  ('family', 'family-sorties-parents-enfants', 'Sorties parents-enfants', 'Parent-child outings', 'baby', 1),
  ('family', 'family-rencontres-parents',      'Rencontres de parents',   'Parent meetups',       'baby', 2)
) as v(parent_slug, slug, name_fr, name_en, icon, sort_order)
join public.categories p on p.slug = v.parent_slug
on conflict (slug) do nothing;

-- Ambiance words
insert into public.ambiance_words (slug, label_fr, label_en, sort_order) values
  ('welcoming',         'Accueillant',              'Welcoming',           1),
  ('relaxed',           'Détendu',                  'Relaxed',             2),
  ('chatty',            'Bavard',                   'Chatty',              3),
  ('sporty',            'Sportif',                  'Sporty',              4),
  ('focused',           'Concentré',                'Focused',             5),
  ('beginners_welcome', 'Débutants bienvenus',      'Beginners welcome',   6),
  ('skilled',           'Bon niveau requis',        'Good level required', 7),
  ('small_group',       'Petit groupe',             'Small group',         8),
  ('large_group',       'Grand groupe',             'Large group',         9),
  ('young_adults',      'Jeunes adultes',           'Young adults',        10),
  ('all_ages',          'Tous âges',                'All ages',            11)
on conflict (slug) do nothing;
