import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('opportunity_status_overrides')
export class OpportunityStatusOverrideEntity {
  @PrimaryColumn({ name: 'opportunity_id', type: 'varchar', length: 255 })
  opportunityId!: string;

  @Column({ type: 'varchar', length: 32 })
  status!: string;
}
