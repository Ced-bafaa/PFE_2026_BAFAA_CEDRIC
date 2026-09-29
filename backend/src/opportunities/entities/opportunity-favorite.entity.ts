import { Entity, PrimaryColumn } from 'typeorm';

@Entity('opportunity_favorites')
export class OpportunityFavoriteEntity {
  @PrimaryColumn({ name: 'opportunity_id', type: 'varchar', length: 255 })
  opportunityId!: string;
}
