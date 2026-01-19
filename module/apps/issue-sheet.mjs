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
      viewImage: IssueSheet.#onViewImage,
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

  /** @inheritdoc */
  _onRender(context, options) {
    super._onRender(context, options);

    this._addSelectTypeListener();
    this._addAttachImgListener();
    this._addSelectPriorityAndStatus();
    this._addEditCommentListener();
  }

  _addSelectTypeListener() {
    const select = this.element.querySelector(".icon-select-container select");
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

  _addAttachImgListener() {
    const imgInput = this.element.querySelector("input.issue-image-upload");
    if (!imgInput) return;

    imgInput.addEventListener("change", (event) => {
      const files = Array.from(event.target.files);
      if (!files.length) return;
      files.forEach((file) => {
        const reader = new FileReader();

        reader.onload = async (e) => {
          const base64String = e.target.result;
          const grid = imgInput
            .closest(".attachments-section")
            .querySelector(".attachments-grid");

          const nextIndex = grid.querySelectorAll(".attachment-item").length;

          const htmlString = `
                <div class="attachment-item" data-index="${nextIndex}">
                    <img src="${base64String}" class="attachment-thumb" loading="lazy">
                    <div class="attachment-overlay">
                        <a class="attachment-action view" data-action="viewImage" data-path="${base64String}">
                            <i class="fa-solid fa-magnifying-glass-plus"></i>
                        </a>
                        <a class="attachment-action delete" data-action="deleteAttachment">
                            <i class="fa-solid fa-trash"></i>
                        </a>
                    </div>
                </div>`;

          grid.insertAdjacentHTML("beforeend", htmlString);
        };

        reader.readAsDataURL(file);
      });

      event.target.value = "";
    });
  }

  _addSelectPriorityAndStatus() {
    const selects = this.element.querySelectorAll(
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

  _addEditCommentListener() {
    const editors = this.element.querySelectorAll(".comment prose-mirror");
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

  _replaceHTML(result, content, options) {
    requestAnimationFrame(() => {
      super._replaceHTML(result, content, options);
    });
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
  static async #onSubmitForm(_event, form, formData) {
    const expanded = foundry.utils.expandObject(formData.object);

    if ("undefined" in expanded) delete expanded.undefined;

    expanded.attachments = Array.from(
      form.querySelectorAll("img.attachment-thumb"),
    ).map((img) => img.src);

    this.issue.validate({ changes: expanded, clean: true, fallback: false });

    const submitBtn = this.element.querySelector("button.submit-button");
    submitBtn.disabled = true;
    const submitIconButton = submitBtn.querySelector("i");
    submitIconButton.classList.remove("fa-floppy-disk");
    submitIconButton.classList.add("fa-spinner", "fa-spin");

    try {
      if (!this.issue.key) {
        const newIssueData = await IssueData.create(expanded);
        this.#issue = newIssueData;
        this.render();
      } else {
        await this.issue.update(expanded);
      }
    } catch (err) {
      console.error(err);
      ui.notifications.error("Failed to save issue.");
      this.render();
    }
  }

  /**
   * @type {ApplicationClickAction}
   * @this IssueSheet
   */
  static #onViewImage(_event, target) {
    const imgEl = target.closest(".attachment-item")?.querySelector("img");

    const ip = new ImagePopout(imgEl.src, {
      title: "Attached Image",
    });

    ip.render(true);
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
   * @type {ApplicationClickAction}
   * @this IssueSheet
   */
  static #onAddAttachment(_event, target) {
    const input = target.querySelector("input");
    input.click();
  }

  /**
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
   *
   * @type {ApplicationClickAction}
   * @this MainHud
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
