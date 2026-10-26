# DCR-02 authoritative review eligibility

The DepositAccount UNREVIEWED-to-REVIEWED database guard now requires a non-demo lease and non-demo tenant and rejects DRAFT status. Existing statement admission still takes shared source then bank before row checks. Eligible ACTIVE, ENDED and CANCELLED zero reviews remain supported. Original legacy rows and already-applied migration targets are not repaired. Candidate003 remains one atomic DO statement and requires a new pristine Core3 target.

Six authored PostgreSQL cases exercise raw and service ineligible review rejection with unchanged account/entry/audit/command state, plus eligible ACTIVE/ENDED/CANCELLED zero reviews. Main executes actual database proof.
