import type { Context } from "hono";
import type { ProfileId } from "../utilities/responses";
import errors from "../utilities/errors";
import { accountService, app, logger, profilesService, userService } from "..";
import ProfileHelper from "../utilities/profiles";
import { Profiles } from "../tables/profiles";
import MCPResponses from "../utilities/responses";
import type { Variants } from "../../types/profilesdefs";
import { handleProfileSelection } from "./QueryProfile";

export default async function (c: Context) {
  const startTimestamp = Date.now();

  const accountId = c.req.param("accountId");
  const rvn = c.req.query("rvn");
  const profileId = c.req.query("profileId") as ProfileId;

  const timestamp = new Date().toISOString();

  if (!accountId || !rvn || !profileId) {
    return c.json(errors.createError(400, c.req.url, "Missing query parameters.", timestamp), 400);
  }

  let [user, account] = await Promise.all([
    userService.findUserByAccountId(accountId),
    accountService.findUserByAccountId(accountId),
  ]);

  if (!user || !account) {
    return c.json(
      errors.createError(404, c.req.url, "Failed to find user, account.", timestamp),
      404,
    );
  }

  const profile = await handleProfileSelection(profileId, user.accountId);

  if (!profile && profileId !== "athena" && profileId !== "common_core")
    return c.json(
      errors.createError(404, c.req.url, `Profile ${profileId} was not found.`, timestamp),
      404,
    );

  if (!profile)
    return c.json(
      errors.createError(404, c.req.url, `Profile '${profileId}' not found.`, timestamp),
      404,
    );

  let body;
  try {
    body = await c.req.json();
  } catch (error) {
    return c.json({ error: "Body isn't valid JSON" }, 400);
  }

  const { itemToSlot, lockerItem, category, slotIndex, variantUpdates } = body;

  let shouldUpdateProfile: boolean = false;
  const applyProfileChanges: object[] = [];

  if (profile.items[itemToSlot]) {
    if (variantUpdates.length > 0 && Array.isArray(variantUpdates)) {
      console.log(variantUpdates);
      variantUpdates.forEach((variant: Variants) => {
        const { channel, active } = variant;
        const itemAttributes = profile.items[itemToSlot].attributes;

        const existingVariant = itemAttributes.variants?.find(
          (v: Variants) => v.channel === channel,
        );

        if (!existingVariant) return;

        if (existingVariant.owned.includes(active)) return;

        existingVariant.active = active;
      });

      applyProfileChanges.push({
        changeType: "itemAttrChanged",
        itemId: itemToSlot,
        attributeName: "variants",
        attributeValue: profile.items[itemToSlot].attributes.variants,
      });
    }
  }

  const updateFavoriteSlot = (slotName: string, items: any[]) => {
    const slotData = profile.items[lockerItem].attributes.locker_slots_data;
    if (slotData && slotData.slots[slotName]) {
      slotData.slots[slotName].items = items;
      // @ts-ignore
      profile.stats.attributes[`favorite_${slotName.toLowerCase()}`] = itemToSlot;
      applyProfileChanges.push({
        changeType: "itemAttrChanged",
        itemId: lockerItem,
        attributeName: "locker_slots_data",
        attributeValue: slotData,
      });
    }
  };

  const updateItemWrapSlot = () => {
    const slotData = profile.items[lockerItem].attributes.locker_slots_data;
    const items = slotData!.slots.ItemWrap.items.fill(itemToSlot);
    profile.stats.attributes.favorite_itemwraps = items.map(() => itemToSlot);
    applyProfileChanges.push({
      changeType: "itemAttrChanged",
      itemId: lockerItem,
      attributeName: "locker_slots_data",
      attributeValue: slotData,
    });
  };

  if (category === "Dance" && slotIndex >= 0 && slotIndex <= 5) {
    const slotData = profile.items[lockerItem].attributes.locker_slots_data;
    if (slotData && slotData.slots.Dance) {
      slotData.slots.Dance.items[slotIndex] = itemToSlot;
      profile.stats.attributes.favorite_dance![slotIndex] = itemToSlot;
      applyProfileChanges.push({
        changeType: "itemAttrChanged",
        itemId: lockerItem,
        attributeName: "locker_slots_data",
        attributeValue: slotData,
      });

      shouldUpdateProfile = true;
    }
  } else if (category === "ItemWrap" && slotIndex >= 0 && slotIndex <= 7) {
    const slotData = profile.items[lockerItem].attributes.locker_slots_data;
    if (slotData && slotData.slots.ItemWrap) {
      slotData.slots.ItemWrap.items[slotIndex] = itemToSlot;
      profile.stats.attributes.favorite_itemwraps![slotIndex] = itemToSlot;
      applyProfileChanges.push({
        changeType: "itemAttrChanged",
        itemId: lockerItem,
        attributeName: "locker_slots_data",
        attributeValue: slotData,
      });
      shouldUpdateProfile = true;
    }
  } else if (slotIndex === -1) {
    updateItemWrapSlot();
    shouldUpdateProfile = true;
  } else {
    updateFavoriteSlot(category, [itemToSlot]);
    shouldUpdateProfile = true;
  }

  if (shouldUpdateProfile) {
    profile.rvn += 1;
    profile.commandRevision += 1;
    profile.updatedAt = new Date().toISOString();

    await profilesService.update(user.accountId, "athena", profile);
  }

  const endTimestamp = Date.now();

  const executionTimeMs = endTimestamp - startTimestamp;

  logger.info(`Execution time: ${executionTimeMs} ms`);

  return c.json(MCPResponses.generate(profile, applyProfileChanges, profileId));
}
