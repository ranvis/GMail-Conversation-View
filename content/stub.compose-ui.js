const Ci = Components.interfaces;
const Cc = Components.classes;
const Cu = Components.utils;
const Cr = Components.results;

Cu.import("resource://gre/modules/XPCOMUtils.jsm"); // for generateQI
Cu.import("resource:///modules/gloda/mimemsg.js"); // For MsgHdrToMimeMessage

const gMessenger = Cc["@mozilla.org/messenger;1"]
                   .createInstance(Ci.nsIMessenger);
const gHeaderParser = Cc["@mozilla.org/messenger/headerparser;1"]
                      .getService(Ci.nsIMsgHeaderParser);

Cu.import("resource://conversations/VariousUtils.jsm");
Cu.import("resource://conversations/MsgHdrUtils.jsm");
Cu.import("resource://conversations/send.js");
Cu.import("resource://conversations/compose.js");
Cu.import("resource://conversations/log.js");

let Log = setupLogging("Conversations.Stub.Compose");

let gComposeParams = {
  msgHdr: null,
  identity: null,
  to: null,
  cc: null,
  bcc: null,
  subject: null,
};

// bug 495747 #c10
let url = "http://www.xulforum.org";
let ios = Components.classes["@mozilla.org/network/io-service;1"]
  .getService(Components.interfaces.nsIIOService);
let ssm = Components.classes["@mozilla.org/scriptsecuritymanager;1"]
  .getService(Components.interfaces.nsIScriptSecurityManager);
let dsm = Components.classes["@mozilla.org/dom/storagemanager;1"]
  .getService(Components.interfaces.nsIDOMStorageManager);
let uri = ios.newURI(url, "", null);
let principal = ssm.getCodebasePrincipal(uri);
let storage = dsm.getLocalStorageForPrincipal(principal, "");

// ----- Event listeners

// Called when we need to expand the textarea and start editing a new message
function onTextareaClicked(event) {
  // Do it just once
  if (!$(event.target).parent().hasClass('expand')) {
    $(event.target).parent().addClass('expand');
  }
  if (!gComposeParams.msgHdr) { // first time
    Log.debug("Setting up the initial quick reply compose parameters...");
    let messages = Conversations.currentConversation.messages;
    try {
      setupReplyForMsgHdr(messages[messages.length - 1].message._msgHdr);
    } catch (e) {
      Log.debug(e);
      dumpCallStack(e);
    }
    scrollNodeIntoView(document.querySelector(".quickReply"));
  }
}

function showCc(event) {
  $(".ccList, .editCcList").css("display", "");
  $(".showCc").hide();
}


function showBcc(event) {
  $(".bccList, .editBccList").css("display", "");
  $(".showBcc").hide();
}

function editFields(aFocusId) {
  $('.quickReplyRecipients').addClass('edit');
  $("#"+aFocusId).next().find(".token-input-input-token-facebook input").last().focus();
}

function onDiscard(event) {
  $("textarea").val("");
  onSave(event);
}

function onSave(event) {
  let id = Conversations.currentConversation.id; // Gloda ID
  if (id) {
    storage.setItem("conversation"+id, $("textarea").val());
  }
  $(".quickReply").removeClass('expand');
}

function loadDraft() {
  let id = Conversations.currentConversation.id; // Gloda ID
  if (id) {
    $("textarea").val(storage.getItem("conversation"+id));
    $("#discard, #save").attr("disabled", "");
  } else {
    $("#discard, #save").attr("disabled", "disabled");
  }
}

function onNewThreadClicked() {
  if ($("#startNewThread:checked").length) {
    $(".editSubject").css("display", "-moz-box");
  } else {
    $(".editSubject").css("display", "none");
  }
}

function useEditor() {
  if (onSend(null, { popOut: true }))
    onDiscard();
}

let gWillArchive = false;

function onSend(event, options) {
  let popOut = options && options.popOut;
  let archive = options && options.archive;
  gWillArchive = archive;
  let textarea = document.getElementsByTagName("textarea")[0];
  let msg = "Send an empty message?";
  if (!popOut && !$(textarea).val().length && !confirm(msg))
    return;

  let isNewThread = $("#startNewThread:checked").length;
  return sendMessage({
      msgHdr: gComposeParams.msgHdr,
      identity: gComposeParams.identity,
      to: $("#to").val(),
      cc: $("#cc").val(),
      bcc: $("#bcc").val(),
      subject: isNewThread ? $("#subject").val() : gComposeParams.subject,
    }, {
      compType: isNewThread ? Ci.nsIMsgCompType.New : Ci.nsIMsgCompType.ReplyAll,
      deliverType: Ci.nsIMsgCompDeliverMode.Now,
    }, textarea, {
      progressListener: progressListener,
      sendListener: sendListener,
      stateListener: stateListener,
    }, {
      popOut: popOut,
      archive: archive,
    });
}

function transferQuickReplyToNewWindow(aWindow, aExpand) {
  // The handler from stub.html called onSave before, and since saving/loading
  //  is synchronous, it works. When we make saving/loading asynchronous, we'll
  //  probably have to come up with something else.
  aWindow.loadDraft();
  // ^^ We have to load the draft anyways since the draft is not necessarily
  //  from this very editing session, it might be a leftover draft from before,
  //  so in any case it should be restored.
  if (!gComposeParams.msgHdr) {
    Log.debug("No quick reply session to transfer to the new tab");
    return;
  }
  try {
    Log.debug("Transferring our quick reply session over to the new tab...");
    // Now we've forwarded the contents. The two lines below setup from, to, cc,
    //  bcc properly.
    let [toNames, toEmails] = parse($("#to").val());
    let [ccNames, ccEmails] = parse($("#cc").val());
    let [bccNames, bccEmails] = parse($("#bcc").val());
    aWindow.gComposeParams = {
      msgHdr: gComposeParams.msgHdr,
      identity: gComposeParams.identity,
      to: [asToken(null, toName, toEmails[i], null)
        for each ([i, toName] in Iterator(toNames))],
      cc: [asToken(null, ccName, ccEmails[i], null)
        for each ([i, ccName] in Iterator(ccNames))],
      bcc: [asToken(null, bccName, bccEmails[i], null)
        for each ([i, bccName] in Iterator(bccNames))],
      subject: gComposeParams.subject,
    };
    aWindow.updateUI();
    // Special code for the subject.
    let isNewThread = $("#startNewThread:checked").length;
    if (isNewThread) {
      aWindow.$("#startNewThread")[0].checked = true;
      aWindow.onNewThreadClicked();
      aWindow.$("#subject").val($("#subject").val());
    }
    // Open if already opened
    if (aExpand)
      aWindow.$("textarea").parent().addClass('expand');
    // That should be pretty much all.
  } catch (e) {
    Log.error(e);
    dumpCallStack(e);
  }
}

// ----- Helpers

// Just get the email and/or name from a MIME-style "John Doe <john@blah.com>"
//  line.
function parse(aMimeLine) {
  let emails = {};
  let fullNames = {};
  let names = {};
  let numAddresses = gHeaderParser.parseHeadersWithArray(aMimeLine, emails, names, fullNames);
  return [names.value, emails.value];
}

// ----- Main logic

// The logic that decides who to compose, from which address, etc. etc.
function setupReplyForMsgHdr(aMsgHdr) {
  // Standard procedure for finding which identity to send with, as per
  // http://mxr.mozilla.org/comm-central/source/mail/base/content/mailCommands.js#210
  let mainWindow = getMail3Pane();
  let identity = mainWindow.getIdentityForHeader(aMsgHdr, Ci.nsIMsgCompType.ReplyAll)
    || gIdentities.default;
  Log.debug("We picked", identity.email, "for sending");
  // Set the global parameters
  gComposeParams.identity = identity;
  gComposeParams.msgHdr = aMsgHdr;
  gComposeParams.subject = "Re: "+aMsgHdr.mime2DecodedSubject;
  $("#subject").val(gComposeParams.subject);

  // Do the whole shebang to find out who to send to...
  let [author, authorEmailAddress] = parse(aMsgHdr.mime2DecodedAuthor);
  let [recipients, recipientsEmailAddresses] = parse(aMsgHdr.mime2DecodedRecipients);
  let [ccList, ccListEmailAddresses] = parse(aMsgHdr.ccList);
  let [bccList, bccListEmailAddresses] = parse(aMsgHdr.bccList);

  let isReplyToOwnMsg = false;
  for each (let [i, identity] in Iterator(gIdentities)) {
    Log.debug("Iterating over identities", i, identity);
    // It happens that gIdentities.default is null!
    if (!identity) {
      Log.debug("This identity is null, pretty weird...");
      continue;
    }
    let email = identity.email;
    if (email == authorEmailAddress)
      isReplyToOwnMsg = true;
    if (recipientsEmailAddresses.filter(function (x) x == email).length)
      isReplyToOwnMsg = false;
    if (ccListEmailAddresses.filter(function (x) x == email).length)
      isReplyToOwnMsg = false;
  }

  // Actually we are implementing the "Reply all" logic... that's better, no one
  //  wants to really use reply anyway ;-)
  if (isReplyToOwnMsg) {
    Log.debug("Replying to our own message...");
    gComposeParams.to = [asToken(null, r, recipientsEmailAddresses[i], null)
      for each ([i, r] in Iterator(recipients))];
  } else {
    gComposeParams.to = [asToken(null, author, authorEmailAddress, null)];
  }
  gComposeParams.cc = [asToken(null, cc, ccListEmailAddresses[i], null)
    for each ([i, cc] in Iterator(ccList))
    if (ccListEmailAddresses[i] != identity.email)];
  if (!isReplyToOwnMsg)
    gComposeParams.cc = gComposeParams.cc.concat
      ([asToken(null, r, recipientsEmailAddresses[i], null)
        for each ([i, r] in Iterator(recipients))
        if (recipientsEmailAddresses[i] != identity.email)]);
  gComposeParams.bcc = [asToken(null, bcc, bccListEmailAddresses[i], null)
    for each ([i, bcc] in Iterator(bccList))];

  // We're streaming the message just to get the reply-to header... kind of a
  //  shame...
  try {
    MsgHdrToMimeMessage(aMsgHdr, null, function (aMsgHdr, aMimeMsg) {
      if ("reply-to" in aMimeMsg.headers) {
        let [name, email] = parse(aMimeMsg.headers["reply-to"]);
        if (email) {
          gComposeParams.to = [asToken(null, name, email, null)];
        }
      }
      updateUI();
      if (!$("textarea").val().length)
        insertQuote(aMsgHdr);
    }, false); // don't download
  } catch (e if e.result == Cr.NS_ERROR_FAILURE) { // Message not available offline.
    // And update our nice composition UI
    updateUI();
    if (!$("textarea").val().length)
      insertQuote(aMsgHdr);
  }
}

function insertQuote(aMsgHdr) {
  quoteMsgHdr(aMsgHdr, function (body) {
    // Join together the different parts
    let date = new Date(aMsgHdr.date/1000);
    let [{ email, name }] = parseMimeLine(aMsgHdr.mime2DecodedAuthor);
    Log.debug(aMsgHdr.mime2DecodedAuthor, email, name);
    Log.debug(body.trim(), citeString("\n"+body.trim()));
    let txt = [
      "\n\n",
      "On ", date.toLocaleString(), ", ",
      (name || email), 
      " wrote:",
      // Actually, the >'s aren't automatically appended
      citeString("\n"+body.trim()),
    ].join("");
    // After we removed any trailing newlines, insert it into the textarea
    $("textarea").val(txt); 
    // I <3 HTML5 selections
    let node = $("textarea")[0];
    node.selectionStart = 0;
    node.selectionEnd = 0;
  });
}

// When all the composition parameters have been set, update the UI with them
// (e.g. recipients, sender, etc.)
function updateUI() {
  let i = gComposeParams.identity;
  $(".senderName").text(i.fullName + " <"+i.email+">");
  setupAutocomplete();
}

// ----- Listeners.
//
// These are notified about the outcome of the send process and take the right
//  action accordingly (close window on success, etc. etc.)
//  
// This process is inherently FLAWED because we can't listen for the end of the
//  "save sent message" event which would actually tell us that we're done. From
//  what I understand from
//  http://mxr.mozilla.org/comm-central/source/mailnews/compose/src/nsMsgCompose.cpp#3520,
//  the onStopSending event tells us that we're done if and only if we're not
//  copying the message to the sent folder.
// Otherwise, we need to listen for the OnStopCopy event.
//  http://mxr.mozilla.org/comm-central/source/mailnews/compose/src/nsMsgSend.cpp#4149
//  But this is harcoded and mListener is nsMsgComposeSendListener in
//  nsMsgCompose.cpp (bad!).
// There's a thing called a state listener that might be what we're looking
//  for...

function pValue (v) {
  $(".statusPercentage")
    .show()
    .text(v+"%");
  $(".statusThrobber").hide();
}

function pUndetermined () {
  $(".statusPercentage").hide();
  $(".statusThrobber").show();
}

function pText (t) {
  $(".statusMessage").text(t);
}

// all progress notifications are done through the nsIWebProgressListener implementation...
let progressListener = {
  onStateChange: function (aWebProgress, aRequest, aStateFlags, aStatus) {
    Log.debug("onStateChange", aWebProgress, aRequest, aStateFlags, aStatus);
    if (aStateFlags & Ci.nsIWebProgressListener.STATE_START) {
      pUndetermined();
      $(".quickReplyHeader").show();
    }

    if (aStateFlags & Ci.nsIWebProgressListener.STATE_STOP) {
      pValue(0);
      pText('');
    }
  },

  onProgressChange: function(aWebProgress, aRequest, aCurSelfProgress, aMaxSelfProgress, aCurTotalProgress, aMaxTotalProgress) {
    Log.debug("onProgressChange", aWebProgress, aRequest, aCurSelfProgress, aMaxSelfProgress, aCurTotalProgress, aMaxTotalProgress);
    // Calculate percentage.
    var percent;
    if (aMaxTotalProgress > 0) {
      percent = Math.round( (aCurTotalProgress*100)/aMaxTotalProgress );
      if (percent > 100)
        percent = 100;

      // Advance progress meter.
      pValue(percent);
    } else {
      // Progress meter should be barber-pole in this case.
      pUndetermined();
    }
  },

  onLocationChange: function(aWebProgress, aRequest, aLocation) {
    // we can ignore this notification
  },

  onStatusChange: function(aWebProgress, aRequest, aStatus, aMessage) {
    pText(aMessage);
  },

  onSecurityChange: function(aWebProgress, aRequest, state) {
    // we can ignore this notification
  },

  QueryInterface: XPCOMUtils.generateQI([
    Ci.nsIWebProgressListener,
    Ci.nsISupports
  ]),
};

let sendListener = {
  /**
   * Notify the observer that the message has started to be delivered. This method is
   * called only once, at the beginning of a message send operation.
   *
   * @return The return value is currently ignored.  In the future it may be
   * used to cancel the URL load..
   */
  onStartSending: function (aMsgID, aMsgSize) {
    pText("Sending message...");
    $("textarea, #send, #sendArchive").attr("disabled", "disabled");
    Log.debug("onStartSending", aMsgID, aMsgSize);
  },

  /**
   * Notify the observer that progress as occurred for the message send
   */
  onProgress: function (aMsgID, aProgress, aProgressMax) {
    Log.debug("onProgress", aMsgID, aProgress, aProgressMax);
  },

  /**
   * Notify the observer with a status message for the message send
   */
  onStatus: function (aMsgID, aMsg) {
    Log.debug("onStatus", aMsgID, aMsg);
  },

  /**
   * Notify the observer that the message has been sent.  This method is 
   * called once when the networking library has finished processing the 
   * message.
   * 
   * This method is called regardless of whether the the operation was successful.
   * aMsgID   The message id for the mail message
   * status   Status code for the message send.
   * msg      A text string describing the error.
   * returnFileSpec The returned file spec for save to file operations.
   */
  onStopSending: function (aMsgID, aStatus, aMsg, aReturnFile) {
    // if (aExitCode == NS_ERROR_SMTP_SEND_FAILED_UNKNOWN_SERVER ||
    //     aExitCode == NS_ERROR_SMTP_SEND_FAILED_UNKNOWN_REASON ||
    //     aExitCode == NS_ERROR_SMTP_SEND_FAILED_REFUSED ||
    //     aExitCode == NS_ERROR_SMTP_SEND_FAILED_INTERRUPTED ||
    //     aExitCode == NS_ERROR_SMTP_SEND_FAILED_TIMEOUT ||
    //     aExitCode == NS_ERROR_SMTP_PASSWORD_UNDEFINED ||
    //     aExitCode == NS_ERROR_SMTP_AUTH_FAILURE ||
    //     aExitCode == NS_ERROR_SMTP_AUTH_GSSAPI ||
    //     aExitCode == NS_ERROR_SMTP_AUTH_MECH_NOT_SUPPORTED ||
    //     aExitCode == NS_ERROR_SMTP_AUTH_NOT_SUPPORTED ||
    //     aExitCode == NS_ERROR_SMTP_AUTH_CHANGE_ENCRYPT_TO_PLAIN_NO_SSL ||
    //     aExitCode == NS_ERROR_SMTP_AUTH_CHANGE_ENCRYPT_TO_PLAIN_SSL ||
    //     aExitCode == NS_ERROR_SMTP_AUTH_CHANGE_PLAIN_TO_ENCRYPT ||
    //     aExitCode == NS_ERROR_STARTTLS_FAILED_EHLO_STARTTLS)
    //
    // Moar in mailnews/compose/src/nsComposeStrings.h
    Log.debug("onStopSending", aMsgID, aStatus, aMsg, aReturnFile);
    $("textarea, #send, #sendArchive").attr("disabled", "");
    // This function is called only when the actual send has been performed,
    //  i.e. is not called when saving a draft (although msgCompose.SendMsg is
    //  called...)
    if (NS_SUCCEEDED(aStatus)) {
      //if (gOldDraftToDelete)
      //  msgHdrsDelete([gOldDraftToDelete]);
      pText("Message "+aMsgID+" sent successfully"); 
    } else {
      pText("Couldn't send the message.");
      Log.debug("NS_FAILED onStopSending");
    }
  },

  /**
   * Notify the observer with the folder uri before the draft is copied.
   */
  onGetDraftFolderURI: function (aFolderURI) {
    Log.debug("onGetDraftFolderURI", aFolderURI);
  },

  /**
   * Notify the observer when the user aborts the send without actually doing the send
   * eg : by closing the compose window without Send.
   */
  onSendNotPerformed: function (aMsgID, aStatus) {
    Log.debug("onSendNotPerformed", aMsgID, aStatus);
  },

  QueryInterface: XPCOMUtils.generateQI([
    Ci.nsIMsgSendListener,
    Ci.nsISupports
  ]),
}

let copyListener = {
  onStopCopy: function (aStatus) {
    Log.debug("onStopCopy", aStatus);
    if (NS_SUCCEEDED(aStatus)) {
      //if (gOldDraftToDelete)
      //  msgHdrsDelete(gOldDraftToDelete);
    }
  },

  QueryInterface: XPCOMUtils.generateQI([
    Ci.nsIMsgCopyServiceListener,
    Ci.nsISupports
  ]),
}

// XXX Should be a closure on gWillArchive, gComposeParams, and
//  Conversations.currentConversation.msgHdrs (for archiving purposes)
let stateListener = {
  NotifyComposeFieldsReady: function() {
    // ComposeFieldsReady();
  },

  NotifyComposeBodyReady: function() {
    // if (gMsgCompose.composeHTML)
    //   loadHTMLMsgPrefs();
    // AdjustFocus();
  },

  ComposeProcessDone: function(aResult) {
    if (NS_SUCCEEDED(aResult)) {
      $(".quickReplyHeader").hide();
      onDiscard();
      // Well we assume the user hasn't changed the quick reply parameters in
      //  the meanwhile... FIXME
      let msgHdr = gComposeParams.msgHdr;
      msgHdr.folder.addMessageDispositionState(msgHdr, Ci.nsIMsgFolder.nsMsgDispositionState_Replied);
      msgHdr.folder.msgDatabase = null;
      // Archive the whole conversation if needed
      if (gWillArchive) {
        // from stub.html. XXX this should be more subtle than that... the
        //  conversation might be something else now...
        archiveConversation();
      }
    }
  },

  SaveInFolderDone: function(folderURI) {
    // DisplaySaveFolderDlg(folderURI);
  }
};
