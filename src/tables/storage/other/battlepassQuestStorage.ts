import { Column, Entity, PrimaryGeneratedColumn } from "typeorm";

export interface BattlepassQuestData {
  [key: string]: {
    templateId: string;
    attributes: Attributes;
    quantity: number;
  };
}

interface Attributes {
  sent_new_notification: boolean;
  challenge_bundle_id: string;
  ObjectiveState: ObjectiveState[];
}

interface ObjectiveState {
  name: string;
  count: number;
}

@Entity()
export class BattlepassQuest {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar", length: 256, nullable: false, unique: true })
  accountId!: string;

  @Column({ type: "jsonb" })
  data!: BattlepassQuestData[];
}
