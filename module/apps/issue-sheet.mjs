import {
  ISSUE_STATUSES,
  ISSUE_TYPES,
  MODULE_ID,
  PRIORITY,
} from "../constants.mjs";
import IssueData from "../data/issue-data.mjs";
import JiraIssueManager from "../jira/jira-manager.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * @import {ApplicationClickAction, ApplicationConfiguration, ApplicationFormSubmission} from "../../foundry/resources/app/client-esm/applications/_types.mjs";
 * @import ApplicationV2 from "../../foundry/resources/app/client-esm/applications/api/application.mjs";
 * @import {HandlebarsTemplatePart} from "../../foundry/resources/app/client-esm/applications/api/handlebars-application.mjs"
 */

/**
 * @extends ApplicationV2
 * @mixes HandlebarsApplicationMixin
 */
export default class IssueSheet extends HandlebarsApplicationMixin(
  ApplicationV2,
) {
  /** @param {Partial<ApplicationConfiguration & {issue: IssueData}>} options */
  constructor(options) {
    super(options);
    this.#issue = options.issue;
  }

  /** @type {ApplicationConfiguration} */
  static DEFAULT_OPTIONS = {
    classes: [MODULE_ID, "issue-sheet"],
    tag: "div",
    window: {
      minimizable: true,
      resizable: true,
      icon: "fab fa-jira",
      contentClasses: ["scrollable"],
    },
    actions: {
      viewFile: IssueSheet.#onViewFile,
      deleteAttachment: IssueSheet.#onDeleteAttachment,
      addAttachment: IssueSheet.#onAddAttachment,
      addComment: IssueSheet.#onAddComment,
      deleteComment: IssueSheet.#onDeleteComment,
      addScoreIssue: IssueSheet.#onAddScoreIssue,
    },
    position: {
      height: 650,
      width: 600,
    },
  };
  /* -------------------------------------------- */

  /**
   * Configure a registry of template parts which are supported for this application for partial rendering.
   * @type {Record<string, HandlebarsTemplatePart>}
   */
  static PARTS = {
    body: {
      template: `modules/${MODULE_ID}/templates/issue-sheet/body.hbs`,
      scrollable: [".scrollable"],
      forms: {
        form: {
          handler: IssueSheet.#onSubmitForm,
          closeOnSubmit: false,
          submitOnChange: false,
        },
      },
    },
    footer: {
      template: `modules/${MODULE_ID}/templates/issue-sheet/footer.hbs`,
    },
  };

  /* -------------------------------------------- */

  #issue;

  /**
   * The issue instance associated with the application
   * @type {IssueData}
   */
  get issue() {
    return this.#issue;
  }

  /* -------------------------------------------- */

  /** @override */
  get title() {
    const { key, summary } = this.issue;
    return `Issue: ${summary || key}`;
  }

  /* -------------------------------------------- */

  /**
   * Is this Issue sheet editable by the current User?
   * @type {boolean}
   */
  get isEditable() {
    return game.user.isGM || this.issue.user?.isSelf;
  }

  /* -------------------------------------------- */
  /*  Rendering                                   */
  /* -------------------------------------------- */

  /** @inheritDoc */
  _configureRenderOptions(options) {
    super._configureRenderOptions(options);
    if (!this.issue.key)
      options.parts = options.parts.filter((p) => p !== "footer");
  }

  /**
   * Extends the base part listener attachment to initialize issue-specific
   * event listeners for the given HTML element.
   * @param {string} partId - The unique identifier for the UI part.
   * @param {HTMLElement} htmlElement - The DOM element containing the part's markup.
   * @param {Object} options - Configuration options for the attachment.
   * @protected
   * @override
   */
  _attachPartListeners(partId, htmlElement, options) {
    super._attachPartListeners(partId, htmlElement, options);

    this._addSelectTypeListener(htmlElement);
    this._renderAttachments(htmlElement);
    this._addAttachImgListener(htmlElement);
    this._addSelectPriorityAndStatus(htmlElement);
    this._addEditCommentListener(htmlElement);
  }

  /**
   * Initializes the listener for the Issue Type dropdown.
   * @param {HTMLElement} element - The parent element containing the type selector.
   */
  _addSelectTypeListener(element) {
    const select = element.querySelector(".icon-select-container select");
    if (!select) return;

    select.addEventListener("change", (event) => {
      /** @type {keyof typeof ISSUE_TYPES} */
      const value = event.target.value;
      const config = ISSUE_TYPES[value];

      const container = event.target.parentElement;
      const currentIcon = event.target.previousElementSibling;

      container.dataset.tooltip = config.label;
      currentIcon.outerHTML = `<i class="issue-icon fa-solid ${config.iconClass}" style="color: ${config.color}"></i>`;
    });
  }

  /**
   * Handles image uploads via file input.
   * @param {HTMLElement} element - The parent element containing the upload input.
   */
  _addAttachImgListener(element) {
    const fileInput = element.querySelector("input.issue-file-upload");
    if (!fileInput) return;

    fileInput.addEventListener("change", async (event) => {
      const files = Array.from(event.target.files);
      const grid = fileInput
        .closest(".attachments-section")
        .querySelector(".attachments-grid");

      for (const file of files) {
        const base64 = await this.#readFileAsDataURL(file);
        const nextIndex = grid.querySelectorAll(".attachment-item").length;
        grid.insertAdjacentElement(
          "beforeend",
          this._renderAttachmentItem(base64, nextIndex),
        );
      }

      event.target.value = "";
    });
  }

  /**
   * Reads a File object and returns its contents as a base64 encoded Data URL.
   * @param {File} file - The File or Blob object to read.
   * @returns {Promise<string|ArrayBuffer|null>}
   * @private
   */
  #readFileAsDataURL(file) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.readAsDataURL(file);
    });
  }

  /**
   * Renders the attachments list into the grid container.
   * @param {HTMLElement} element - The parent element containing the attachments grid.
   * @protected
   */
  _renderAttachments(element) {
    const container = element.querySelector(".attachments-grid");
    if (!container) return;

    container.innerHTML = "";

    this.issue.attachments.forEach((attch, idx) => {
      const item = this._renderAttachmentItem(attch, idx);
      container.appendChild(item);
    });
  }

  /**
   * Crea y retorna un elemento de adjunto (imagen o video).
   * @param {string} attachment - URL o Base64 del archivo.
   * @param {number} index - Índice para el atributo data.
   * @returns {HTMLElement}
   */
  _renderAttachmentItem(attachment, index) {
    const isVideo =
      attachment.startsWith("data:video/") ||
      /\.(m4v|mp4|ogv|webm)$/i.test(attachment);

    const item = document.createElement("div");
    item.classList.add("attachment-item");
    item.dataset.index = index;
    item.dataset.type = isVideo ? "video" : "image";

    const media = isVideo
      ? `<video src="${attachment}" class="attachment-thumb" muted playsinline></video>`
      : `<img src="${attachment}" class="attachment-thumb" loading="lazy">`;

    const overlay = `
    <div class="attachment-overlay">
      <a class="attachment-action view" data-action="viewFile" data-path="${attachment}">
        <i class="fa-solid ${isVideo ? "fa-play" : "fa-magnifying-glass-plus"}"></i>
      </a>
      <a class="attachment-action delete" data-action="deleteAttachment">
        <i class="fa-solid fa-trash"></i>
      </a>
    </div>`;

    item.insertAdjacentHTML("afterbegin", media);
    item.insertAdjacentHTML("beforeend", overlay);
    return item;
  }

  /**
   * Syncs the visual state of Priority and Status dropdowns.
   * @param {HTMLElement} element - The parent element containing the select inputs.
   */
  _addSelectPriorityAndStatus(element) {
    const selects = element.querySelectorAll(
      '[name="priority"], [name="status"]',
    );
    selects.forEach((select) => {
      select.addEventListener("change", (event) => {
        const { name, value, previousElementSibling } = event.target;
        const config = { priority: PRIORITY, status: ISSUE_STATUSES }[name][
          value
        ];
        const icon = previousElementSibling.querySelector("i");
        icon.className = `issue-icon ${config.iconClass}`;
        if (name === "priority") icon.classList.add("fa-solid");
        icon.style.color = config.color;
      });
    });
  }

  /**
   * Attaches change listeners to rich text editors (prose-mirror) for comments.
   * @param {HTMLElement} element - The parent element containing comment editors.
   */
  _addEditCommentListener(element) {
    const editors = element.querySelectorAll(".comment prose-mirror");
    editors.forEach((editor) =>
      editor.addEventListener("change", (event) => {
        const commentID = event.target.closest(".comment")?.dataset.id;
        JiraIssueManager.editComment(
          this.issue.key,
          commentID,
          event.target.value,
        );
      }),
    );
  }

  /**@inheritdoc */
  _replaceHTML(result, content, options) {
    requestAnimationFrame(() => {
      super._replaceHTML(result, content, options);
    });
  }

  /**@inheritdoc */
  async _preClose(options) {
    await super._preClose(options);

    if (!this.isEditable) return;

    if (!this.issue.key) {
      const confirmSave = await foundry.applications.api.DialogV2.confirm({
        window: { title: "Unsaved Changes" },
        content:
          "Do you want to close the window without creating a new Issue?",
        yes: {
          label: "Create Issue",
        },
        no: {
          label: "Discard",
        },
        rejectClose: false,
      });

      if (!confirmSave) return;
    }

    await this.#handleSave();
  }

  /* -------------------------------------------- */

  /** @inheritDoc */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const issue = this.issue;
    return {
      ...context,
      issue,
      isNew: !issue.key,
      source: issue._source,
      fields: issue.schema.fields,
      editable: this.isEditable,
      description: {
        value: issue._source.description,
        enrich: await issue.getEnrichDescription(),
        field: issue.schema.fields.description,
      },
      comments: await Promise.all(
        Object.values(issue.comments).map(async (c) => {
          c.enrichBody = await c.getEnrichBody();
          return c;
        }),
      ),
      user: game.user,
      newCommentField:
        foundry.applications.elements.HTMLProseMirrorElement.create({
          toggled: false,
          compact: true,
          height: 150,
          value: "",
          name: "newComment",
        }).outerHTML,
    };
  }

  /* -------------------------------------------- */

  /**
   * @type {ApplicationFormSubmission}
   * @this IssueSheet
   */
  static async #onSubmitForm(_event, _form, formData) {
    if (this.isEditable) await this.#handleSave(formData.object);
  }

  /**
   * Persists changes to the issue.
   * @param {Object} [data] - Optional explicit data to save; otherwise, it is extracted from the form.
   * @returns {Promise<void>}
   * @private
   */
  async #handleSave(data = null) {
    const form = this.element?.querySelector("form");
    if (!form) return;

    const rawData = data || new FormDataExtended(form).object;
    const expanded = foundry.utils.expandObject(rawData);

    expanded.attachments = Array.from(
      form.querySelectorAll("img.attachment-thumb"),
    ).map((img) => img.src);

    const normalizeDescription = ({ description = "" }) =>
      foundry.applications.parseHTML(description).outerHTML;

    const issueData = this.issue.toObject();

    issueData.description = normalizeDescription(issueData);
    expanded.description = normalizeDescription(expanded);

    const diff = foundry.utils.diffObject(issueData, expanded);
    if (foundry.utils.isEmpty(diff)) return;

    this.#toggleSubmitState(true);

    try {
      if (!this.issue.key) {
        this.#issue = await IssueData.create(this.issue.clone(expanded));
        this.render();
      } else {
        await this.issue.update(expanded);
      }
      this.#toggleSubmitState(false, true);
    } catch (err) {
      console.error(err);
      ui.notifications.error("Failed to save issue.");
      this.#toggleSubmitState(false, false);
    }
  }

  /**
   * Toggles the visual loading state of the submit button.
   * @param {boolean} isSaving - Whether the application is currently in a saving/loading state.
   * @private
   */
  #toggleSubmitState(isSaving, success = false) {
    const btn = this.element?.querySelector("button.submit-button");
    const icon = btn?.querySelector("i");
    if (!btn || !icon) return;

    icon.className = "issue-icon fa-solid";

    if (isSaving) {
      btn.disabled = true;
      icon.classList.add("fa-spinner", "fa-spin");
    } else {
      btn.disabled = false;

      if (success) {
        icon.classList.add("fa-check");

        setTimeout(() => {
          if (!this.element) return;
          icon.className = "issue-icon fa-solid fa-floppy-disk";
        }, 2000);
      } else {
        icon.classList.add("fa-floppy-disk");
      }
    }
  }

  /**
   * Maneja el evento de click para visualizar archivos (imágenes o videos).
   * @param {ClipboardEvent} event
   * @this IssueSheet
   */
  static async onPasteFile(event) {
    const isAppActive = ui.activeWindow === this;
    const items = event.clipboardData?.items;
    if (!items || !isAppActive) return;

    const grid = this.element.querySelector(".attachments-grid");
    if (!grid) return;

    for (const item of items) {
      if (item.kind === "file") {
        const file = item.getAsFile();
        if (
          !file ||
          (!file.type.startsWith("image/") && !file.type.startsWith("video/"))
        )
          continue;

        const base64 = await this.#readFileAsDataURL(file);
        const nextIndex = grid.querySelectorAll(".attachment-item").length;

        grid.insertAdjacentElement(
          "beforeend",
          this._renderAttachmentItem(base64, nextIndex),
        );

        ui.notifications.info(`Pasted: ${file.name || "Clipboard Image"}`);
      }
    }
  }

  /**
   * Maneja el evento de click para visualizar archivos (imágenes o videos).
   * @type {ApplicationClickAction}
   * @this IssueSheet
   */
  static #onViewFile(_event, target) {
    const item = target.closest(".attachment-item");
    if (!item) return;

    const path = target.dataset.path;
    const type = item.dataset.type;

    if (type === "video") {
      new foundry.applications.api.DialogV2({
        window: "Attached Video",
        content: `
        <div style="background: black; display: flex; align-items: center; justify-content: center;">
            <video src="${path}" controls autoplay style="max-width: 100%; max-height: 50vh; "></video>
          </div>
        `,
        buttons: [
          {
            action: "close",
            label: "Close",
          },
        ],
      }).render({ force: true });
    } else {
      const ip = new ImagePopout(path, {
        title: "Attached Image",
        shareable: true,
      });
      ip.render(true);
    }
  }

  /**
   * @type {ApplicationClickAction}
   * @this IssueSheet
   */
  static #onDeleteAttachment(_event, target) {
    const attachmentItem = target.closest(".attachment-item");
    attachmentItem.remove();
  }

  /**
   * Triggers the file selection dialog by clicking the hidden file input.
   * @type {ApplicationClickAction}
   * @this IssueSheet
   */
  static #onAddAttachment(_event, target) {
    const input = target.querySelector("input");
    input.click();
  }

  /**
   * Handles adding a new comment to the Jira issue.
   * @type {ApplicationClickAction}
   * @this IssueSheet
   */
  static async #onAddComment(_event, target) {
    const formData = new FormDataExtended(target.closest("form"));
    const newComment = formData.object.newComment;
    if (!newComment) return;
    target.disabled = true;
    const icon = target.querySelector("i");
    icon.classList.remove("fa-paper-plane");
    icon.classList.add("fa-spinner", "fa-spin");

    await JiraIssueManager.addComment(this.issue.key, newComment);
    await this.render({ parts: ["footer"] });
    const content = this.element.querySelector(".window-content");
    if (content) {
      content.scrollTo({
        top: content.scrollHeight,
        behavior: "smooth",
      });
    }
  }

  /**
   * Handles the deletion of a comment, with a confirmation dialog unless Shift is held.
   * @type {ApplicationClickAction}
   * @this IssueSheet
   */
  static async #onDeleteComment(event, target) {
    const id = target.closest("[data-id]").dataset.id;

    target.disabled = true;
    target.classList.remove("fa-paper-plane");
    target.classList.add("fa-spinner", "fa-spin");
    if (event.shiftKey) {
      await JiraIssueManager.deleteComment(this.issue.key, id);
    } else {
      Dialog.confirm({
        title: `${game.i18n.format("DOCUMENT.Delete", { type: "Comment" })}: ${this.issue.key} - ${id}`,
        content: `<h4>${game.i18n.localize("AreYouSure")}</h4><p>${game.i18n.format("SIDEBAR.DeleteWarning", { type: "Comment" })}</p>`,
        yes: () => JiraIssueManager.deleteComment(this.issue.key, id),
      });
    }
    await this.render({ parts: ["footer"] });
  }

  /**
   * Handles voting or scoring on an issue.
   * @type {ApplicationClickAction}
   * @this IssueSheet
   */
  static async #onAddScoreIssue(_event, target) {
    const score = Number(target.dataset.score);
    if (!score) return;

    const currentVoters = this.issue._source.voters;
    const existingVoter = currentVoters.find((v) => v.userId === game.user.id);

    let newVoters;

    if (existingVoter?.vote === score) {
      newVoters = currentVoters.filter((v) => v.userId !== game.user.id);
    } else {
      newVoters = [
        ...currentVoters.filter((v) => v.userId !== game.user.id),
        { userId: game.user.id, vote: score },
      ];
    }

    const span = target.parentElement.querySelector("span");
    span.innerText = "";
    span.classList.add("fa-solid", "fa-spinner", "fa-spin");
    span.style.opacity = 0.5;
    await this.issue.update({ voters: newVoters });
  }
}
