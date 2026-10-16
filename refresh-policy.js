// Editing and outstanding writes defer automatic refresh without losing its deadline.
export function refreshIsBlocked({loading, favoriteMutationPending, pendingInvites, notificationBusy, friendEditor, worldEditor, notificationReply} = {}) {
  return Boolean(loading || favoriteMutationPending || pendingInvites || notificationBusy || notificationReply || (friendEditor && !friendEditor.outcomeUnknown) || (worldEditor && !worldEditor.unknown));
}
