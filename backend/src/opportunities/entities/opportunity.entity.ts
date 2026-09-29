import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('opportunities')
export class OpportunityEntity {
  @PrimaryColumn({ type: 'varchar', length: 255 })
  id!: string;

  /** Clé transverse (dédoublonnage multi-sources), optionnelle selon la source. */
  @Column({ name: 'stable_id', type: 'varchar', length: 512, nullable: true })
  stableId!: string | null;

  @Column({ type: 'text' })
  title!: string;

  @Column({ type: 'varchar', length: 255 })
  source!: string;

  @Column({ name: 'published_at', type: 'varchar', length: 64 })
  publishedAt!: string;

  /** Dernière date/heure de scraping (ISO) : sert d'indicateur de fraîcheur côté front. */
  @Column({ name: 'scraped_at', type: 'varchar', length: 64, nullable: true })
  scrapedAt!: string | null;

  @Column({ type: 'varchar', length: 64 })
  deadline!: string;

  @Column({ type: 'varchar', length: 255 })
  budget!: string;

  @Column({ type: 'varchar', length: 255 })
  location!: string;

  @Column({ type: 'varchar', length: 255 })
  domain!: string;

  @Column({ type: 'int' })
  score!: number;

  @Column({ type: 'varchar', length: 32 })
  recommendation!: string;

  @Column({ type: 'varchar', length: 32 })
  status!: string;

  @Column({ type: 'text' })
  description!: string;

  /** UUID du PDF téléchargé pour traçabilité (dataset extraction). */
  @Column({
    name: 'internal_file_id',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  internalFileId!: string | null;

  /**
   * Données d'enrichissement renvoyées par le pipeline Python (extraction PDF).
   * Stockage souple (JSON sérialisé) pour éviter de multiplier les colonnes au début.
   */
  @Column({ name: 'enrichment', type: 'simple-json', nullable: true })
  enrichment!: Record<string, any> | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
