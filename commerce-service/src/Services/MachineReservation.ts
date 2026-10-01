import { CustomException } from "../../commons/Exception/CustomException.js";
import { conflict, notFound } from "../../commons/Utils/StatusCode.js";
import type { IBatch, IMachine } from "../Models/StoreFloor/StoreFloor.Interface.js";
import { BatchQuery } from "../Queries/Batch.Query.js";
import type { Db } from "../Queries/Floor.Transaction.js";
import { MachineQuery } from "../Queries/Machine.Query.js";
import { MACHINES_FOR } from "./BatchCompatibility.js";

export const MACHINE_NOT_FOUND = "Machine not found.";

const refusal = (machine: IMachine): CustomException => {
  if (machine.state === "running") return new CustomException(`${machine.name} is running another batch.`, conflict);
  if (machine.state === "reserved") return new CustomException(`${machine.name} is already reserved.`, conflict);
  return new CustomException(`${machine.name} is out of service.`, conflict);
};

/**
 * Reserves a machine for a planned batch, from either side (the machine's reserve or the batch's
 * assign-machine). The machine moves idle to reserved in one conditional UPDATE, so of two staff
 * asking for the same machine exactly one gets it. Giving a batch a different machine releases
 * the old one in the same transaction.
 */
export const reserveForBatch = async (batch: IBatch, machineId: string, until: Date | null, tx: Db): Promise<void> => {
  if (batch.status !== "planned") {
    throw new CustomException("Only a planned batch can be given a machine.", conflict);
  }
  const machine = await MachineQuery.findById(machineId, batch.storeId, tx);
  if (!machine) throw new CustomException(MACHINE_NOT_FOUND, notFound);
  if (!MACHINES_FOR[batch.stage].includes(machine.type)) {
    throw new CustomException(`A ${machine.type} cannot run a ${batch.stage} batch.`, conflict);
  }
  if (batch.machineId === machine.id && machine.state === "reserved" && machine.currentBatchId === batch.id) return;

  if (batch.machineId) {
    await MachineQuery.release(batch.machineId, batch.id, tx);
    if (!(await BatchQuery.setMachine(batch.id, batch.machineId, null, tx))) {
      throw new CustomException("This batch was changed by someone else. Reload and try again.", conflict);
    }
  }
  if (!(await MachineQuery.reserve(machine.id, batch.storeId, batch.id, until, tx))) {
    // Someone else won the machine between our read and the write: say why from the current row.
    const current = await MachineQuery.findById(machine.id, batch.storeId, tx);
    throw current ? refusal(current) : new CustomException(MACHINE_NOT_FOUND, notFound);
  }
  if (!(await BatchQuery.setMachine(batch.id, null, machine.id, tx))) {
    throw new CustomException("This batch was changed by someone else. Reload and try again.", conflict);
  }
};
