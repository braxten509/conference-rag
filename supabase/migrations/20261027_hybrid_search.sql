-- ============================================
-- Hybrid search = keyword search + semantic search, merged.
-- ============================================

-- 1. Smarter keyword search: Postgres full-text search.
--    to_tsvector('english', text) turns a sentence into its "root words":
--      'Praying brings peace to our hearts' -> 'pray' 'bring' 'peac' 'heart'
--    (filler words like "to", "our" are dropped; "praying" and "prayers"
--    both become "pray"). This GIN index lists, for each root word, which
--    sentences contain it -- like the index at the back of a book.
--    It's an index on an expression, so the table itself isn't rewritten.
CREATE INDEX IF NOT EXISTS sentence_embeddings_fts_idx
ON sentence_embeddings USING gin (to_tsvector('english', text));

-- 2. The hybrid search function.
CREATE OR REPLACE FUNCTION hybrid_search(
  query_text text,
  query_embedding vector(1536),
  match_count int DEFAULT 20,
  rrf_k int DEFAULT 60
)
RETURNS TABLE (
  id uuid,
  talk_id uuid,
  title text,
  speaker text,
  url text,
  text text,
  keyword_rank int,
  semantic_rank int,
  similarity float,
  score float
)
LANGUAGE sql STABLE
AS $$
  WITH
  -- The question's root words joined with OR ("find | peac | hard | time"),
  -- so a sentence only needs SOME of the words, not all of them.
  q AS (
    SELECT to_tsquery('english',
             array_to_string(tsvector_to_array(to_tsvector('english', query_text)), ' | ')) AS tsq
  ),
  -- List A: keyword matches, best first. ts_rank_cd scores sentences higher
  -- when they contain more of the words, and when those words sit close together.
  keyword AS (
    SELECT s.id,
           row_number() OVER (ORDER BY ts_rank_cd(to_tsvector('english', s.text), q.tsq) DESC)::int AS rank
    FROM sentence_embeddings s, q
    WHERE to_tsvector('english', s.text) @@ q.tsq
    ORDER BY rank
    LIMIT match_count * 2
  ),
  -- List B: meaning matches, best first. The inner ORDER BY ... LIMIT is the
  -- exact shape the HNSW index needs, so this stays fast.
  semantic AS (
    SELECT n.id, row_number() OVER (ORDER BY n.dist)::int AS rank
    FROM (
      SELECT s.id, s.embedding <=> query_embedding AS dist
      FROM sentence_embeddings s
      ORDER BY s.embedding <=> query_embedding
      LIMIT match_count * 2
    ) n
  )
  -- Merge with Reciprocal Rank Fusion: each list gives a sentence
  -- 1 / (60 + its place in that list). Being on both lists adds both scores.
  SELECT
    s.id, s.talk_id, s.title, s.speaker, s.url, s.text,
    k.rank AS keyword_rank,
    m.rank AS semantic_rank,
    1 - (s.embedding <=> query_embedding) AS similarity,
    COALESCE(1.0 / (rrf_k + k.rank), 0) + COALESCE(1.0 / (rrf_k + m.rank), 0) AS score
  FROM keyword k
  FULL OUTER JOIN semantic m ON m.id = k.id
  JOIN sentence_embeddings s ON s.id = COALESCE(k.id, m.id)
  ORDER BY score DESC
  LIMIT match_count;
$$;
