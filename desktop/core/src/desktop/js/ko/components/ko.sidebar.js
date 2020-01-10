// Licensed to Cloudera, Inc. under one
// or more contributor license agreements.  See the NOTICE file
// distributed with this work for additional information
// regarding copyright ownership.  Cloudera, Inc. licenses this file
// to you under the Apache License, Version 2.0 (the
// "License"); you may not use this file except in compliance
// with the License.  You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import $ from 'jquery';
import * as ko from 'knockout';

import apiHelper from 'api/apiHelper';
import componentUtils from 'ko/components/componentUtils';
import huePubSub from 'utils/huePubSub';
import I18n from 'utils/i18n';
import { GET_KNOWN_CONFIG_EVENT, CONFIG_REFRESHED_EVENT } from 'utils/hueConfig';

export const NAME = 'hue-sidebar';

const CLOSE_ON_NEW_HOVER_EVENT = 'hue.sidebar.close.on.new.hover';

// prettier-ignore
const TEMPLATE = `
  <script type="text/html" id="sidebar-inner-item">
    <!-- ko if: iconHtml -->
    <div class="icon" data-bind="html: iconHtml"></div><span data-bind="text: displayName"></span>
    <!-- /ko -->
    <!-- ko ifnot: iconHtml -->
    <div class="icon" data-bind="hueAppIcon: icon"></div><span data-bind="text: displayName"></span>
    <!-- /ko -->
  </script>

  <script type="text/html" id="sidebar-sub-menu">
    <div class="sidebar-menu" data-bind="
        css: {
          'open' : open() || hoverOpen(),
          'fixed-bottom': fixedBottom
        },
        event: {
          mouseenter: mouseEnter
        }
      ">
      <div class="inner">
        <div class="menu">
          <!-- ko if: headerTemplate -->
          <div class="menu-header" data-bind="template: headerTemplate"></div>
          <!-- /ko -->

          <ul class="sidebar-nav-list" data-bind="foreach: children">
            <li data-bind="css: { 'divider': isDivider }">
              <!-- ko if: isDivider -->
                &nbsp;
              <!-- /ko -->
              <!-- ko ifnot: isDivider -->
                <!-- ko if: children && children.length -->
                  <a href="javascript:void(0);" data-bind="toggle: open, text: displayName"></a>
                  <!-- ko template: { name: 'sidebar-sub-menu' } --><!-- /ko -->
                <!-- /ko -->
                <!-- ko if: !children && url -->
                  <a href="javascript:void(0);" data-bind="hueLink: url, text: displayName"></a>
                <!-- /ko -->
                <!-- ko if: !children && href -->
                  <a href="javascript:void(0);" target="_blank" data-bind="attr: { 'href': href }, text: displayName"></a>
                <!-- /ko -->
                <!-- ko if: !children && click -->
                  <a href="javascript:void(0);" target="_blank" data-bind="click: click.bind($data), text: displayName"></a>
                <!-- /ko -->
              <!-- /ko -->
            </li>
          </ul>
        </div>
      </div>
    </div>
  </script>

  <script type="text/html" id="sidebar-item">
    <div class="item-wrapper" data-bind="css: itemClass, event: { mouseenter: mouseEnter, mouseleave: mouseLeave }">
      <!-- ko if: children && children.length -->
        <a href="javascript: void(0);" data-bind="
            toggle: open,
            css: { 'active': active },
            template: 'sidebar-inner-item'
          " class="item"></a>
          <!-- ko template: 'sidebar-sub-menu' --><!-- /ko -->
      <!-- /ko -->
      <!-- ko if: !children || !children.length -->
        <!-- ko if: click -->
          <a href="javascript: void(0);" data-bind="
              click: click,
              attr: { 'aria-label': displayName, 'data-tooltip': displayName },
              css: { 'active': active },
              template: 'sidebar-inner-item'
            " class="item"></a>
        <!-- /ko -->
        <!-- ko ifnot: click -->
          <a href="javascript: void(0);" data-bind="
              hueLink: url,
              publish: 'hue.sidebar.update.active',
              attr: { 'aria-label': displayName, 'data-tooltip': displayName },
              css: { 'active': active },
              template: 'sidebar-inner-item'
            " class="item"></a>
        <!-- /ko -->
      <!-- /ko -->
    </div>
  </script>

  <script type="text/html" id="user-header-template">
    <div class="user-icon" style="background-color: #fff">${ window.LOGGED_USERNAME[0].toUpperCase() }</div>
    <div>
      <div>${ window.LOGGED_USERNAME }</div>
    </div>
  </script>

  <!-- ko if: window.DISPLAY_APP_SWITCHER -->
  <!-- ko component: { name: 'hue-app-switcher' } --><!-- /ko -->
  <!-- /ko -->
  <!-- ko ifnot: window.DISPLAY_APP_SWITCHER -->
  <div class="hue-sidebar-header" data-bind="css: { 'hue-sidebar-custom-logo' : window.CUSTOM_LOGO }">
    <a data-bind="hueLink: '/home/'" href="javascript: void(0);" title="${I18n('Documents')}">
      <div class="hue-sidebar-logo"><svg><use xlink:href="#hi-sidebar-logo"></use></svg></div>
    </a>
  </div>
  <!-- /ko -->
  <div class="hue-sidebar-body">
    <!-- ko foreach: items -->
      <!-- ko if: isCategory -->
        <!-- ko ifnot: $index() === 0 -->
        <div class="item-spacer"></div>
        <!-- /ko -->
        <!-- ko template: {name: 'sidebar-item', foreach: children } --><!-- /ko -->
      <!-- /ko -->
      <!-- ko ifnot: isCategory -->
        <!-- ko template: { name: 'sidebar-item' } --><!-- /ko -->
      <!-- /ko -->
    <!-- /ko -->
  </div>
  <div class="hue-sidebar-footer">
    <!-- ko foreach: footerItems -->
    <!-- ko template: { name: 'sidebar-item' } --><!-- /ko -->
    <!-- /ko -->
    <a class="hue-sidebar-trigger" data-bind="toggle: collapsed">
      <svg><use xlink:href="#hi-collapse-nav"></use></svg>
    </a>
  </div>
`;

const trackCloseOnClick = (observable, id) => {
  observable.subscribe(newVal => {
    if (newVal) {
      window.setTimeout(() => {
        $(document).on('click.' + id, () => {
          observable(false);
        });
      }, 0);
    } else {
      $(document).off('click.' + id);
    }
  });
};

class SidebarItem {
  constructor(options) {
    this.isCategory = !!options.isCategory;
    this.displayName = options.displayName;
    this.isDivider = !!options.isDivider;
    this.href = options.href;
    this.url = options.url;
    this.icon = options.icon;
    this.children = options.children;
    this.name = options.name;
    this.type = options.type;
    this.active = ko.observable(false);
    this.open = ko.observable(false);
    this.hoverOpen = ko.observable(false);
    this.click = options.click;
    this.iconHtml = options.iconHtml;
    this.itemClass = options.itemClass;
    this.headerTemplate = options.headerTemplate;
    this.fixedBottom = !!options.fixedBottom;

    trackCloseOnClick(this.open, 'sidebar-sub');
    trackCloseOnClick(this.hoverOpen, 'sidebar-sub');
    this.hoverdelay = -1;

    this.open.subscribe(() => {
      huePubSub.publish(CLOSE_ON_NEW_HOVER_EVENT, this);
      window.clearTimeout(this.hoverdelay);
      this.hoverOpen(false);
    });

    huePubSub.subscribe(CLOSE_ON_NEW_HOVER_EVENT, item => {
      if (item !== this) {
        window.clearTimeout(this.hoverdelay);
        this.hoverOpen(false);
        this.open(false);
      }
    });
  }

  mouseEnter() {
    if (this.open()) {
      return;
    }
    huePubSub.publish(CLOSE_ON_NEW_HOVER_EVENT, this);
    window.clearTimeout(this.hoverdelay);
    this.hoverOpen(true);
  }

  mouseLeave() {
    window.clearTimeout(this.hoverdelay);
    this.hoverdelay = window.setTimeout(() => {
      this.hoverOpen(false);
    }, 400);
  }
}

class Sidebar {
  constructor(params, element) {
    this.$element = $(element);

    this.collapsed = ko.observable();
    this.userMenuOpen = ko.observable(false);
    this.supportMenuOpen = ko.observable(false);

    trackCloseOnClick(this.userMenuOpen, 'userMenuOpen');

    trackCloseOnClick(this.supportMenuOpen, 'supportMenuOpen');

    this.collapsed.subscribe(newVal => {
      if (newVal) {
        this.$element.addClass('collapsed');
      } else {
        this.$element.removeClass('collapsed');
      }
    });

    apiHelper.withTotalStorage('hue.sidebar', 'collabse', this.collapsed, true);

    this.items = ko.observableArray();

    const userChildren = [];

    if (window.USER_VIEW_EDIT_USER_ENABLED) {
      userChildren.push(
        new SidebarItem({
          url: '/useradmin/users/edit/' + window.LOGGED_USERNAME,
          displayName: I18n('My Profile')
        })
      );
    }

    if (window.USER_IS_ADMIN || window.USER_IS_ORG_ADMIN) {
      userChildren.push(
        new SidebarItem({ url: '/useradmin/users/', displayName: I18n('Manage Users') })
      );
      userChildren.push(new SidebarItem({ url: '/about/', displayName: I18n('Administration') }));
    }

    userChildren.push(new SidebarItem({ url: '/accounts/logout', displayName: I18n('Sign out') }));

    this.footerItems = [
      new SidebarItem({
        displayName: 'Support',
        icon: 'support',
        children: [
          new SidebarItem({
            displayName: I18n('Documentation'),
            href: 'https://docs.gethue.com'
          }),
          new SidebarItem({
            displayName: I18n('Welcome Tour'),
            click: () => {
              huePubSub.publish('show.welcome.tour');
            }
          }),
          new SidebarItem({
            displayName: 'Gethue.com',
            href: 'https://gethue.com'
          })
        ],
        fixedBottom: true
      }),
      new SidebarItem({
        displayName: window.LOGGED_USERNAME,
        itemClass: 'shepherd-user-menu',
        iconHtml: '<div class="user-icon">' + window.LOGGED_USERNAME[0].toUpperCase() + '</div>',
        headerTemplate: 'user-header-template',
        children: userChildren,
        fixedBottom: true
      })
    ];
    this.lastAppName = undefined;

    const updateActive = () => {
      this.userMenuOpen(false);
      this.supportMenuOpen(false);
      this.items().forEach(item => {
        item.children.forEach(child => {
          let active = false;
          if (this.lastAppName === 'editor') {
            active = child.type === 'editor';
          } else if (this.lastAppName === 'filebrowser') {
            if (location.href.indexOf('=S3A') !== -1) {
              active = child.type === 's3';
            } else if (location.href.indexOf('=adl') !== -1) {
              active = child.type === 'adls';
            } else if (location.href.indexOf('=abfs') !== -1) {
              active = child.type === 'abfs';
            } else {
              active = child.type === 'hdfs';
            }
          } else {
            active = location.pathname === '/hue' + child.url;
          }
          child.active(active);
        });
      });
    };

    const configUpdated = clusterConfig => {
      const items = [];

      if (clusterConfig && clusterConfig.app_config) {
        const favourite = clusterConfig.main_button_action;
        const appsItems = [];
        const appConfig = clusterConfig.app_config;

        ['editor', 'dashboard', 'scheduler', 'sdkapps'].forEach(appName => {
          const config = appConfig[appName];
          if (config && config.interpreters.length) {
            if (config.interpreters.length === 1) {
              appsItems.push(
                new SidebarItem({
                  displayName: config.displayName,
                  url: config.interpreters[0].page,
                  icon: config.name,
                  type: config.name
                })
              );
            } else {
              const subApps = [];
              let lastWasSql = false;
              let dividerAdded = false;
              config.interpreters.forEach(interpreter => {
                if (!dividerAdded && lastWasSql && !interpreter.is_sql) {
                  subApps.push(new SidebarItem({ isDivider: true }));
                  dividerAdded = true;
                }
                if (favourite && favourite.page === interpreter.page) {
                  // Put the favourite on top
                  subApps.unshift(
                    new SidebarItem({
                      displayName: interpreter.displayName,
                      url: interpreter.page,
                      icon: interpreter.dialect || interpreter.name,
                      type: interpreter.dialect || interpreter.name
                    })
                  );
                } else {
                  subApps.push(
                    new SidebarItem({
                      displayName: interpreter.displayName,
                      url: interpreter.page,
                      icon: interpreter.dialect || interpreter.name,
                      type: interpreter.dialect || interpreter.name
                    })
                  );
                }
                lastWasSql = interpreter.is_sql;
              });

              if (appName === 'editor' && window.SHOW_ADD_MORE_EDITORS) {
                subApps.push(new SidebarItem({ isDivider: true }));
                subApps.push(
                  new SidebarItem({
                    displayName: I18n('Add more...'),
                    href: 'https://docs.gethue.com/administrator/configuration/connectors/'
                  })
                );
              }
              appsItems.push(
                new SidebarItem({
                  displayName: config.displayName,
                  icon: config.name,
                  type: config.name,
                  children: subApps
                })
              );
            }
          }
        });

        if (appsItems.length > 0) {
          items.push(
            new SidebarItem({
              isCategory: true,
              displayName: I18n('Apps'),
              children: appsItems
            })
          );
        }

        const browserItems = [];
        if (appConfig.home) {
          browserItems.push(
            new SidebarItem({
              displayName: appConfig.home.buttonName,
              url: appConfig.home.page,
              icon: 'documents',
              type: appConfig.home.name
            })
          );
        }
        if (appConfig.browser && appConfig.browser.interpreters) {
          appConfig.browser.interpreters.forEach(browser => {
            browserItems.push(
              new SidebarItem({
                displayName: browser.displayName,
                url: browser.page,
                icon: browser.type,
                type: browser.type
              })
            );
          });
        }
        if (browserItems.length > 0) {
          items.push(
            new SidebarItem({
              isCategory: true,
              displayName: appConfig.browser.displayName,
              children: browserItems
            })
          );
        }
      }

      this.items(items);
      updateActive();
    };

    huePubSub.publish(GET_KNOWN_CONFIG_EVENT, configUpdated);
    huePubSub.subscribe(CONFIG_REFRESHED_EVENT, configUpdated);

    let throttle = -1;
    huePubSub.subscribe('set.current.app.name', appName => {
      if (!appName) {
        return;
      }
      this.lastAppName = appName;
      window.clearTimeout(throttle);
      throttle = window.setTimeout(updateActive, 20);
    });
    updateActive();

    huePubSub.subscribe('hue.sidebar.update.active', updateActive);
  }

  toggleCollapse() {
    this.$element.toggleClass('collapsed');
  }
}

componentUtils.registerComponent(
  NAME,
  {
    createViewModel: function(params, componentInfo) {
      return new Sidebar(params, componentInfo.element);
    }
  },
  TEMPLATE
);
